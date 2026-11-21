import type { SupabaseClient } from '@supabase/supabase-js';

/** Port of the Convex `purchases` rows and helpers (packages/backend/convex/purchases.ts). */
export type PurchaseTier = 'vip' | 'paid';

export type RecordPurchaseResult =
    | { success: false; reason: string }
    | { success: true; alreadyRecorded: true; token: string }
    | { success: true; alreadyRecorded: false; token: string; tier: PurchaseTier; expiresAt: string };

export interface ActiveSubscription {
    tier: PurchaseTier;
    productId: string;
    expiresAt?: string;
    purchaseToken: string;
    transactionId?: string;
}

interface PurchaseRow {
    id: string;
    device_id: string;
    product_id: string;
    tier: PurchaseTier;
    purchase_token: string;
    transaction_id: string | null;
    status: string;
    receipt_data: string | null;
    verified_at: string | null;
    expires_at: string | null;
    created_at: string;
    updated_at: string | null;
}

interface AccessTokenRow {
    id: string;
    token: string;
    type: PurchaseTier;
    device_id: string;
    is_active: boolean;
}

/** api.purchases.recordPurchase — records the purchase and auto-creates an
 * access token. Trust-on-first-use: status is 'verified', same as Convex. */
export async function recordPurchase(
    db: SupabaseClient,
    input: { deviceId: string; productId: string; purchaseToken: string; transactionId?: string; receiptData?: string },
): Promise<RecordPurchaseResult> {
    // Map productId → tier (same rule as Convex purchases.ts).
    const tier = getTierForProduct(input.productId);
    if (!tier) {
        return { success: false, reason: `Unknown product: ${input.productId}` };
    }

    // Check for duplicate by purchase token.
    const { data: existingRows } = await db
        .from('purchases')
        .select('*')
        .eq('purchase_token', input.purchaseToken)
        .limit(1);
    const existing = existingRows && existingRows.length > 0 ? (existingRows[0] as PurchaseRow) : null;

    if (existing) {
        // A revoked purchase must not be resurrected by the app's silent
        // restore — the user removed access by admin action. Never create or
        // re-activate a token for it.
        if (existing.status === 'revoked') {
            return { success: false, reason: 'revoked' };
        }
        // Already recorded — just re-grant the access token if needed.
        const { data: tokenRows } = await db
            .from('access_tokens')
            .select('token')
            .eq('device_id', input.deviceId)
            .eq('type', tier)
            .eq('is_active', true)
            .limit(1);
        if (tokenRows && tokenRows.length > 0) {
            return { success: true, alreadyRecorded: true, token: (tokenRows[0] as { token: string }).token };
        }

        // Purchase exists but no token — create one.
        const token = genToken(tier);
        const { error } = await db.from('access_tokens').insert({
            convex_id: crypto.randomUUID(),
            token,
            device_id: input.deviceId,
            type: tier,
            created_at: new Date().toISOString(),
            is_active: true,
            is_claimed: true,
        });
        if (error) throw new Error(error.message);
        return { success: true, alreadyRecorded: true, token };
    }

    // Calculate expiry (same rule as Convex purchases.ts).
    const expiresAt = getExpiryForProduct(input.productId);
    const now = new Date().toISOString();

    // Insert purchase record.
    const { error: insertError } = await db.from('purchases').insert({
        convex_id: crypto.randomUUID(),
        device_id: input.deviceId,
        product_id: input.productId,
        tier,
        purchase_token: input.purchaseToken,
        transaction_id: input.transactionId ?? null,
        status: 'verified', // trust-on-first-use, same as Convex
        receipt_data: input.receiptData ?? null,
        verified_at: now,
        expires_at: expiresAt,
        created_at: now,
    });
    if (insertError) throw new Error(insertError.message);

    // Create access token.
    const token = genToken(tier);
    const { error: tokenError } = await db.from('access_tokens').insert({
        convex_id: crypto.randomUUID(),
        token,
        device_id: input.deviceId,
        type: tier,
        created_at: now,
        expires_at: expiresAt,
        is_active: true,
        is_claimed: true,
    });
    if (tokenError) throw new Error(tokenError.message);

    return { success: true, alreadyRecorded: false, token, tier, expiresAt };
}

/** api.purchases.getActiveSubscription — the newest verified, non-expired
 * purchase for the device; null when there is none (or it is expired).
 * Revoked purchases never count: revokeToken sets their status to 'revoked'
 * and only 'verified' rows are accepted here. */
export async function getActiveSubscription(db: SupabaseClient, deviceId: string): Promise<ActiveSubscription | null> {
    const { data } = await db
        .from('purchases')
        .select('*')
        .eq('device_id', deviceId)
        .eq('status', 'verified')
        .neq('status', 'revoked')
        .order('created_at', { ascending: false });
    const purchase = data?.find((p) => !p.expires_at || new Date(p.expires_at) > new Date());
    if (!purchase) return null;
    return {
        tier: purchase.tier,
        productId: purchase.product_id,
        expiresAt: purchase.expires_at ?? undefined,
        purchaseToken: purchase.purchase_token,
        transactionId: purchase.transaction_id ?? undefined,
    };
}

// --- Helpers (ports of Convex purchases.ts) ---

/** Map Google Play product ID → access tier. */
function getTierForProduct(productId: string): PurchaseTier | null {
    if (productId.includes('.vip.')) return 'vip';
    if (productId.includes('.paid.')) return 'paid';
    return null;
}

/** Calculate expiry date from product ID: weekly +7d, monthly +1mo, else +7d. */
function getExpiryForProduct(productId: string): string {
    const now = new Date();
    if (productId.includes('.weekly')) {
        now.setDate(now.getDate() + 7);
    } else if (productId.includes('.monthly')) {
        now.setMonth(now.getMonth() + 1);
    } else {
        // Default: 7 days
        now.setDate(now.getDate() + 7);
    }
    return now.toISOString();
}

/** Generate a short readable access token (VIP-/PAD- prefix). */
function genToken(tier: PurchaseTier): string {
    const prefix = tier === 'vip' ? 'VIP' : 'PAD';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = prefix + '-';
    for (let i = 0; i < 12; i++) {
        token += chars[Math.floor(Math.random() * chars.length)];
        if ((i + 1) % 4 === 0 && i < 11) token += '-';
    }
    return token;
}
