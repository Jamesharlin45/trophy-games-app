import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMail } from '@/lib/mailer';

/** Server-side helpers for the `email_outbox` table. Rows are created by
 * POST /api/app/purchases/set-email (mobile, right after a purchase) and
 * sent by GET /api/cron/send-emails (cron + opportunistic triggers). */

export const EMAIL_DELAY_MINUTES = 10;

const EMAIL_SUBJECT = 'Trophy Games — Your Access Token';

export type SetPurchaseEmailResult =
    | { success: false; reason: string }
    | { success: true; action: 'inserted' | 'updated' | 'already_sent' };

export type SendDueEmailsResult = {
    /** Rows actually sent via SMTP. */
    sent: number;
    /** Rows cancelled before sending (token/purchase not sendable anymore). */
    cancelled: number;
    /** Rows attempted and failed (stored with attempts + last_error). */
    failed: number;
};

interface OutboxRow {
    id: string;
    sent_at: string | null;
    cancelled_at: string | null;
    attempts: number;
}

interface PurchaseRow {
    id: string;
    tier: string;
    expires_at: string | null;
    status: string;
}

interface AccessTokenRow {
    is_active: boolean;
    revoked_at: string | null;
    expires_at: string | null;
}

// ---------------------------------------------------------------------------
// set-email
// ---------------------------------------------------------------------------

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function nextSendAfter(dueNow?: boolean): string {
    const now = new Date();
    const sendAt = dueNow ? now : new Date(now.getTime() + EMAIL_DELAY_MINUTES * 60_000);
    return sendAt.toISOString();
}

async function setPurchaseEmailColumn(
    db: SupabaseClient,
    deviceId: string,
    purchaseToken: string,
    email: string,
): Promise<void> {
    const { error } = await db
        .from('purchases')
        .update({ email })
        .eq('purchase_token', purchaseToken)
        .eq('device_id', deviceId);
    if (error) throw new Error(error.message);
}

/** One new email request per device per hour (update paths are exempt — see
 * setPurchaseEmail). */
async function deviceHasRecentOutboxRow(db: SupabaseClient, deviceId: string): Promise<boolean> {
    const { data: devicePurchases } = await db
        .from('purchases')
        .select('id')
        .eq('device_id', deviceId);
    const purchaseIds = ((devicePurchases ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (purchaseIds.length === 0) return false;

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await db
        .from('email_outbox')
        .select('id')
        .in('purchase_id', purchaseIds)
        .is('cancelled_at', null)
        .gte('created_at', since)
        .limit(1);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<{ id: string }>).length > 0;
}

/** api.app.purchases.setEmail — store the buyer's email on the purchase and
 * make sure ONE outbox row exists for the purchase's access token.
 * Idempotent: a second call updates the pending row instead of inserting a
 * second email. `dueNow` (test-only, not used by the app) sends immediately
 * instead of waiting EMAIL_DELAY_MINUTES. */
export async function setPurchaseEmail(
    db: SupabaseClient,
    input: { deviceId: string; purchaseToken: string; email: string; dueNow?: boolean },
): Promise<SetPurchaseEmailResult> {
    const email = input.email.trim();
    if (!isValidEmail(email)) {
        return { success: false, reason: 'Invalid email address' };
    }

    const { data: purchaseRows, error: purchaseError } = await db
        .from('purchases')
        .select('id, tier, expires_at')
        .eq('purchase_token', input.purchaseToken)
        .eq('device_id', input.deviceId)
        .limit(1);
    if (purchaseError) throw new Error(purchaseError.message);
    const purchase = (purchaseRows ?? [])[0] as PurchaseRow | undefined;
    if (!purchase) {
        return { success: false, reason: 'Purchase not found' };
    }

    // The outbox row stores the app access token.
    const { data: tokenRows, error: tokenError } = await db
        .from('access_tokens')
        .select('token')
        .eq('device_id', input.deviceId)
        .eq('type', purchase.tier as 'vip' | 'paid')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1);
    if (tokenError) throw new Error(tokenError.message);
    const accessToken = (tokenRows ?? [])[0] as { token: string } | undefined;
    if (!accessToken) {
        return { success: false, reason: 'No active access token found for this purchase' };
    }

    // Idempotency: find existing rows for this access token.
    const { data: outboxRows, error: outboxError } = await db
        .from('email_outbox')
        .select('id, sent_at, cancelled_at')
        .eq('token', accessToken.token)
        .limit(10);
    if (outboxError) throw new Error(outboxError.message);
    const existing = ((outboxRows ?? []) as Array<OutboxRow>)
        .slice()
        .sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''));
    const pending = existing.find((r) => r.sent_at === null && r.cancelled_at === null);
    if (pending) {
        // Still pending: update the row so the address can be changed before
        // sending — never a second email.
        const { error } = await db
            .from('email_outbox')
            .update({ to_email: email, send_after: nextSendAfter(input.dueNow) })
            .eq('id', pending.id);
        if (error) throw new Error(error.message);
        await setPurchaseEmailColumn(db, input.deviceId, input.purchaseToken, email);
        return { success: true, action: 'updated' };
    }
    if (existing.some((r) => r.sent_at !== null)) {
        return { success: true, action: 'already_sent' };
    }

    // Rate limit per device.
    if (await deviceHasRecentOutboxRow(db, input.deviceId)) {
        return { success: false, reason: 'Rate limited: one new email per device per hour' };
    }

    const { text, html } = buildEmailBody({
        token: accessToken.token,
        plan: purchase.tier === 'vip' ? 'VIP' : 'Paid',
        expiresAt: purchase.expires_at,
    });
    const { error: insertError } = await db.from('email_outbox').insert({
        to_email: email,
        subject: EMAIL_SUBJECT,
        body_text: text,
        body_html: html,
        token: accessToken.token,
        purchase_id: purchase.id,
        send_after: nextSendAfter(input.dueNow),
        attempts: 0,
    });
    if (insertError) throw new Error(insertError.message);
    await setPurchaseEmailColumn(db, input.deviceId, input.purchaseToken, email);
    return { success: true, action: 'inserted' };
}

// ---------------------------------------------------------------------------
// sender (cron + opportunistic)
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatExpiryDate(expiresAt: string | null): string {
    if (!expiresAt) return 'unknown';
    const date = new Date(expiresAt);
    return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
}

function buildEmailBody(input: { token: string; plan: string; expiresAt: string | null }): {
    text: string;
    html: string;
} {
    const expiresLine = `Expires: ${formatExpiryDate(input.expiresAt)}`;
    const instructions =
        'How to use it: open the Trophy Games app, go to the Store (Market) screen and enter the token where the plan shows as unavailable — or verify it with the "ACTIVATE ACCESS" button. Your access starts right away; this email is a backup copy for other devices and reinstalls.';
    const text = [
        'Trophy Games — Your Access Token',
        '',
        `Your access token: ${input.token}`,
        '',
        `Plan: ${input.plan}`,
        expiresLine,
        '',
        instructions,
        '',
        'If you did not ask for this email, ignore it.',
    ].join('\n');
    const html = [
        '<!DOCTYPE html><html><body>',
        '<p><strong>Trophy Games — Your Access Token</strong></p>',
        `<p><code style="word-break: break-all;">${escapeHtml(input.token)}</code></p>`,
        `<p>${escapeHtml(`Plan: ${input.plan}`)}<br/>${escapeHtml(expiresLine)}</p>`,
        `<p>${escapeHtml(instructions)}</p>`,
        '<p>If you did not ask for this email, ignore it.</p>',
        '</body></html>',
    ].join('');
    return { text, html };
}

async function fetchPurchaseAndToken(
    db: SupabaseClient,
    row: OutboxRow & { token: string; purchase_id: string | null },
): Promise<{ purchase: PurchaseRow | undefined; token: AccessTokenRow | undefined }> {
    const { data: purchaseRows } = await db
        .from('purchases')
        .select('id, tier, expires_at, status')
        .eq('id', row.purchase_id)
        .limit(1);
    const { data: tokenRows } = await db
        .from('access_tokens')
        .select('is_active, revoked_at, expires_at')
        .eq('token', row.token)
        .limit(1);
    return {
        purchase: (purchaseRows ?? [])[0] as PurchaseRow | undefined,
        token: (tokenRows ?? [])[0] as AccessTokenRow | undefined,
    };
}

function isSendable(
    purchase: PurchaseRow | undefined,
    token: AccessTokenRow | undefined,
    now: Date,
): boolean {
    if (!purchase) return false;
    if (purchase.status === 'revoked') return false;
    if (!token) return false;
    if (!token.is_active) return false;
    if (token.revoked_at) return false;
    if (token.expires_at && new Date(token.expires_at) < now) return false;
    return true;
}

/** Send due outbox rows: `send_after <= now`, not sent/cancelled, attempts <
 * 5 — oldest first, at most `limit` per call (default 20). Before sending, a
 * row is cancelled when its token is revoked/inactive/expired or its purchase
 * is revoked. On SMTP failure the row gets an attempt + last_error; on success
 * sent_at is set and an attempt is recorded. */
export async function sendDueEmails(
    db: SupabaseClient,
    options: { limit?: number } = {},
): Promise<SendDueEmailsResult> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
    const now = new Date();
    const { data: rows, error } = await db
        .from('email_outbox')
        .select('id, token, purchase_id, attempts, to_email')
        .lte('send_after', now)
        .lt('attempts', 5)
        .is('sent_at', null)
        .is('cancelled_at', null)
        .order('send_after', { ascending: true })
        .limit(limit);
    if (error) throw new Error(error.message);

    const result: SendDueEmailsResult = { sent: 0, cancelled: 0, failed: 0 };
    for (const row of (rows ?? []) as Array<OutboxRow & { token: string; purchase_id: string | null; to_email: string }>) {
        const { purchase, token } = await fetchPurchaseAndToken(db, row);
        if (!isSendable(purchase, token, now)) {
            const { error: cancelError } = await db
                .from('email_outbox')
                .update({ cancelled_at: new Date().toISOString() })
                .eq('id', row.id);
            if (cancelError) throw new Error(cancelError.message);
            result.cancelled += 1;
            continue;
        }

        const plan = purchase?.tier === 'vip' ? 'VIP' : 'Paid';
        const { text, html } = buildEmailBody({
            token: row.token,
            plan,
            expiresAt: purchase?.expires_at ?? token?.expires_at ?? null,
        });
        const mail = await sendMail({ to: row.to_email, subject: EMAIL_SUBJECT, text, html });
        if (mail.ok) {
            const { error: updateError } = await db
                .from('email_outbox')
                .update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
                .eq('id', row.id);
            if (updateError) throw new Error(updateError.message);
            result.sent += 1;
        } else {
            const { error: updateError } = await db
                .from('email_outbox')
                .update({ attempts: row.attempts + 1, last_error: mail.error })
                .eq('id', row.id);
            if (updateError) throw new Error(updateError.message);
            result.failed += 1;
        }
    }
    return result;
}
