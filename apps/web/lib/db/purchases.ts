import type { SupabaseClient } from '@supabase/supabase-js';
import {
    isLegacyDeviceId,
    isUuid,
    isValidDeviceId,
    legacyDeviceAccessAllowed,
} from '@/lib/device-id';

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
    is_claimed?: boolean;
    expires_at?: string | null;
    revoked_at?: string | null;
}

/** Create a purchase-backed access token (always claimed: the buyer is the
 * device that paid). All NOT NULL Convex import columns are populated. */
async function issuePurchaseToken(
    db: SupabaseClient,
    input: { deviceId: string; tier: PurchaseTier; expiresAt: string | null },
): Promise<string> {
    const token = genToken(input.tier);
    const now = new Date().toISOString();
    const { error } = await db.from('access_tokens').insert({
        convex_id: crypto.randomUUID(),
        convex_created_at: now,
        token,
        device_id: input.deviceId,
        type: input.tier,
        created_at: now,
        expires_at: input.expiresAt,
        is_active: true,
        is_claimed: true,
        claimed_at: now,
    });
    if (error) throw new Error(error.message);
    return token;
}

/**
 * App update migration: the Play purchase token already exists but is bound
 * to a shared legacy device id. Re-bind the purchase and its live token(s) to
 * the new per-install UUID (or issue a fresh token if none is live) so paying
 * subscribers keep access after updating.
 */
async function rebindLegacyPurchase(
    db: SupabaseClient,
    purchase: PurchaseRow,
    deviceId: string,
): Promise<string> {
    const now = new Date().toISOString();
    const { error: purchaseError } = await db
        .from('purchases')
        .update({ device_id: deviceId, updated_at: now })
        .eq('id', purchase.id);
    if (purchaseError) throw new Error(purchaseError.message);

    const { data: tokenRows, error: tokenError } = await db
        .from('access_tokens')
        .select('id, token, expires_at, is_active, revoked_at')
        .eq('device_id', purchase.device_id)
        .eq('type', purchase.tier)
        .order('created_at', { ascending: false });
    if (tokenError) throw new Error(tokenError.message);
    const live = ((tokenRows ?? []) as AccessTokenRow[]).filter(
        (row) =>
            row.is_active &&
            !row.revoked_at &&
            (!row.expires_at || new Date(row.expires_at) > new Date()),
    );
    if (live.length === 0) {
        return issuePurchaseToken(db, { deviceId, tier: purchase.tier, expiresAt: purchase.expires_at });
    }

    const { error: rebindError } = await db
        .from('access_tokens')
        .update({ device_id: deviceId })
        .in('id', live.map((row) => row.id));
    if (rebindError) throw new Error(rebindError.message);
    return live[0].token;
}

/** api.purchases.recordPurchase — records the purchase and auto-creates an
 * access token. Trust-on-first-use: status is 'verified', same as Convex. */
export async function recordPurchase(
    db: SupabaseClient,
    input: { deviceId: string; productId: string; purchaseToken: string; transactionId?: string; receiptData?: string },
): Promise<RecordPurchaseResult> {
    if (!isValidDeviceId(input.deviceId)) {
        return { success: false, reason: 'Invalid device id' };
    }

    // Map productId → tier (same rule as Convex purchases.ts).
    const tier = getTierForProduct(input.productId);
    if (!tier) {
        return { success: false, reason: `Unknown product: ${input.productId}` };
    }

    // Check for duplicate by purchase token (the authoritative Play id).
    const { data: existingRows, error: existingError } = await db
        .from('purchases')
        .select('*')
        .eq('purchase_token', input.purchaseToken)
        .limit(1);
    if (existingError) throw new Error(existingError.message);
    const existing = existingRows && existingRows.length > 0 ? (existingRows[0] as PurchaseRow) : null;

    if (existing) {
        // A revoked purchase must not be resurrected by the app's silent
        // restore — the user removed access by admin action. Never create or
        // re-activate a token for it.
        if (existing.status === 'revoked') {
            return { success: false, reason: 'revoked' };
        }
        if (isUuid(input.deviceId) && isLegacyDeviceId(existing.device_id)) {
            const token = await rebindLegacyPurchase(db, existing, input.deviceId);
            return { success: true, alreadyRecorded: true, token };
        }
        // Already recorded — just re-grant the access token if needed.
        const { data: tokenRows, error: tokenError } = await db
            .from('access_tokens')
            .select('id, token, expires_at, is_active, revoked_at')
            .eq('device_id', input.deviceId)
            .eq('type', tier)
            .eq('is_active', true)
            .order('created_at', { ascending: false });
        if (tokenError) throw new Error(tokenError.message);
        const live = ((tokenRows ?? []) as AccessTokenRow[]).find(
            (row) => !row.revoked_at && (!row.expires_at || new Date(row.expires_at) > new Date()),
        );
        if (live) {
            return { success: true, alreadyRecorded: true, token: live.token };
        }

        // Purchase exists but no live token — issue a replacement.
        const token = await issuePurchaseToken(db, {
            deviceId: input.deviceId,
            tier,
            expiresAt: existing.expires_at,
        });
        return { success: true, alreadyRecorded: true, token };
    }

    // Calculate expiry (same rule as Convex purchases.ts).
    const expiresAt = getExpiryForProduct(input.productId);
    const now = new Date().toISOString();

    // Insert purchase record (keep the payment row even after revocation).
    const { error: insertError } = await db.from('purchases').insert({
        convex_id: crypto.randomUUID(),
        convex_created_at: now,
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

    const token = await issuePurchaseToken(db, { deviceId: input.deviceId, tier, expiresAt });
    return { success: true, alreadyRecorded: false, token, tier, expiresAt };
}

/** api.purchases.getActiveSubscription — the newest verified, non-expired
 * purchase for the device; null when there is none (or it is expired).
 * Revoked purchases never count: revokeToken sets their status to 'revoked'
 * and only 'verified' rows are accepted here. */
export async function getActiveSubscription(db: SupabaseClient, deviceId: string): Promise<ActiveSubscription | null> {
    if (isLegacyDeviceId(deviceId) && !legacyDeviceAccessAllowed()) return null;
    const { data, error } = await db
        .from('purchases')
        .select('*')
        .eq('device_id', deviceId)
        .eq('status', 'verified')
        .neq('status', 'revoked')
        .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
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
