import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMail } from '@/lib/mailer';

/** Server-side helpers for the `email_outbox` table. Rows are created by the
 * purchase email endpoint and by admin approvals / resends, and sent by
 * after() at the end of those requests, with /api/cron/send-emails as the
 * retry safety net. */

/** Named delay for purchase emails. */
export const EMAIL_DELAY_MINUTES = 1;

const EMAIL_SUBJECT = 'Trophy Games — Your Access Token';

export type SetPurchaseEmailResult =
    | { success: false; reason: string }
    | { success: true; action: 'inserted' | 'updated' | 'already_sent' };

export type EnqueueTokenEmailResult =
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

export interface EmailStatusSummary {
    pending: number;
    sent: number;
    failed: number;
    /** Most recent SMTP/configuration errors, newest first. Never credentials. */
    lastErrors: string[];
}

export interface TokenEmailStatus {
    status: 'pending' | 'sent' | 'failed' | 'none';
    lastError?: string;
}

interface OutboxRow {
    id: string;
    sent_at: string | null;
    cancelled_at: string | null;
    attempts: number;
    last_error: string | null;
    created_at?: string;
}

interface PurchaseRow {
    id: string;
    device_id: string;
    tier: string;
    expires_at: string | null;
    status: string;
}

interface AccessTokenRow {
    is_active: boolean;
    revoked_at: string | null;
    expires_at: string | null;
}

export function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
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

/** One new email request per device per hour (update paths are exempt). */
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

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatExpiryDate(expiresAt: string | null): string {
    if (!expiresAt) return 'unknown';
    const date = new Date(expiresAt);
    return Number.isNaN(date.getTime()) ? 'unknown' : date.toISOString().slice(0, 10);
}

function buildEmailBody(input: { token: string; plan: string; expiresAt: string | null }): {
    subject: string;
    text: string;
    html: string;
} {
    const expiresLine = `Expires: ${formatExpiryDate(input.expiresAt)}`;
    const instructions =
        'How to use it: open the Trophy Games app, go to the Store (Market) screen and enter the token where the plan shows as unavailable — or verify it with the "ACTIVATE ACCESS" button. Your access starts right away; this email is a backup copy for other devices and reinstalls.';
    return {
        subject: EMAIL_SUBJECT,
        text: [
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
        ].join('\n'),
        html: [
            '<!DOCTYPE html><html><body>',
            '<p><strong>Trophy Games — Your Access Token</strong></p>',
            `<p><code style="word-break: break-all;">${escapeHtml(input.token)}</code></p>`,
            `<p>${escapeHtml(`Plan: ${input.plan}`)}<br/>${escapeHtml(expiresLine)}</p>`,
            `<p>${escapeHtml(instructions)}</p>`,
            '<p>If you did not ask for this email, ignore it.</p>',
            '</body></html>',
        ].join(''),
    };
}

/**
 * Create (or reuse) ONE outbox row for a token. Used by the purchase flow and
 * by manual approvals/resends. A sent row is never duplicated; a pending or
 * previously failed row is refreshed and its retries reset.
 */
export async function enqueueTokenEmail(
    db: SupabaseClient,
    input: {
        token: string;
        toEmail: string;
        tier: string;
        expiresAt?: string | null;
        purchaseId?: string | null;
        requestId?: string | null;
        dueNow?: boolean;
        /** Admin "Resend": a new row is allowed even if an earlier one was sent. */
        allowResend?: boolean;
    },
): Promise<EnqueueTokenEmailResult> {
    const email = input.toEmail.trim();
    if (!isValidEmail(email)) return { success: false, reason: 'Invalid email address' };
    if (!input.token) return { success: false, reason: 'Token is required' };

    const { data: rows, error } = await db
        .from('email_outbox')
        .select('id, sent_at, cancelled_at, attempts')
        .eq('token', input.token)
        .limit(20);
    if (error) throw new Error(error.message);
    const existing = (rows ?? []) as OutboxRow[];
    if (!input.allowResend && existing.some((row) => row.sent_at !== null)) {
        return { success: true, action: 'already_sent' };
    }

    const body = buildEmailBody({
        token: input.token,
        plan: input.tier === 'vip' ? 'VIP' : 'Paid',
        expiresAt: input.expiresAt ?? null,
    });
    const sendAfter = nextSendAfter(input.dueNow);

    const pending = existing.find((row) => row.sent_at === null && row.cancelled_at === null);
    if (pending) {
        const { error: updateError } = await db
            .from('email_outbox')
            .update({
                to_email: email,
                subject: body.subject,
                body_text: body.text,
                body_html: body.html,
                send_after: sendAfter,
                attempts: 0,
                last_error: null,
                cancelled_at: null,
            })
            .eq('id', pending.id);
        if (updateError) throw new Error(updateError.message);
        return { success: true, action: 'updated' };
    }

    const { error: insertError } = await db.from('email_outbox').insert({
        to_email: email,
        subject: body.subject,
        body_text: body.text,
        body_html: body.html,
        token: input.token,
        purchase_id: input.purchaseId ?? null,
        request_id: input.requestId ?? null,
        send_after: sendAfter,
        attempts: 0,
    });
    if (insertError) throw new Error(insertError.message);
    return { success: true, action: 'inserted' };
}

// ---------------------------------------------------------------------------
// set-email (purchase flow)
// ---------------------------------------------------------------------------

/** api.app.purchases.setEmail — store the buyer's email on the purchase and
 * make sure ONE outbox row exists for its access token. */
export async function setPurchaseEmail(
    db: SupabaseClient,
    input: { deviceId: string; purchaseToken: string; email: string; dueNow?: boolean },
): Promise<SetPurchaseEmailResult> {
    const email = input.email.trim();
    if (!isValidEmail(email)) {
        return { success: false, reason: 'Invalid email address' };
    }

    // The Google Play purchase token is the authoritative identifier. Device
    // IDs include the app version, so matching on both would reject a valid
    // email after an app update or a reinstall on the same Play account.
    const { data: purchaseRows, error: purchaseError } = await db
        .from('purchases')
        .select('id, device_id, tier, expires_at')
        .eq('purchase_token', input.purchaseToken)
        .limit(1);
    if (purchaseError) throw new Error(purchaseError.message);
    const purchase = (purchaseRows ?? [])[0] as PurchaseRow | undefined;
    if (!purchase) {
        return { success: false, reason: 'Purchase not found' };
    }
    if (purchase.status === 'revoked') {
        return { success: false, reason: 'Purchase access was revoked' };
    }

    const deviceIds = Array.from(new Set([input.deviceId, purchase.device_id]));
    const { data: tokenRows, error: tokenError } = await db
        .from('access_tokens')
        .select('token')
        .eq('type', purchase.tier as 'vip' | 'paid')
        .eq('is_active', true)
        .in('device_id', deviceIds)
        .order('created_at', { ascending: false })
        .limit(1);
    if (tokenError) throw new Error(tokenError.message);
    const accessToken = (tokenRows ?? [])[0] as { token: string } | undefined;
    if (!accessToken) {
        return { success: false, reason: 'No active access token found for this purchase' };
    }

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

    // Rate limit only genuinely new emails; updating an existing pending row
    // (e.g. fixing a typo) remains allowed.
    if (!pending && await deviceHasRecentOutboxRow(db, input.deviceId)) {
        return { success: false, reason: 'Rate limited: one new email per device per hour' };
    }

    const queued = await enqueueTokenEmail(db, {
        token: accessToken.token,
        toEmail: email,
        tier: purchase.tier,
        expiresAt: purchase.expires_at,
        purchaseId: purchase.id,
        dueNow: input.dueNow,
    });
    if (!queued.success) return { success: false, reason: queued.reason };

    await setPurchaseEmailColumn(db, input.deviceId, input.purchaseToken, email);
    return { success: true, action: queued.action };
}

// ---------------------------------------------------------------------------
// sender (after() + cron)
// ---------------------------------------------------------------------------

async function fetchPurchaseAndToken(
    db: SupabaseClient,
    row: OutboxRow & { token: string; purchase_id: string | null },
): Promise<{ purchase: PurchaseRow | undefined; token: AccessTokenRow | undefined }> {
    const { data: purchaseRows } = row.purchase_id
        ? await db
            .from('purchases')
            .select('id, device_id, tier, expires_at, status')
            .eq('id', row.purchase_id)
            .limit(1)
        : { data: null };
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
    // Manual requests have no purchase row; only purchase-backed rows need one.
    if (purchase?.status === 'revoked') return false;
    if (!token) return false;
    if (!token.is_active) return false;
    if (token.revoked_at) return false;
    if (token.expires_at && new Date(token.expires_at) < now) return false;
    return true;
}

/** Send due outbox rows: `send_after <= now`, not sent/cancelled, attempts <
 * 5 — oldest first, at most `limit` per call (default 20). Before sending, a
 * row is cancelled when its token is revoked/inactive/expired or its purchase
 * is revoked. On SMTP failure the row gets an attempt + last_error. */
export async function sendDueEmails(
    db: SupabaseClient,
    options: { limit?: number } = {},
): Promise<SendDueEmailsResult> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
    const now = new Date();
    const { data: rows, error } = await db
        .from('email_outbox')
        .select('id, token, purchase_id, attempts, to_email, subject, body_text, body_html')
        .lte('send_after', now)
        .lt('attempts', 5)
        .is('sent_at', null)
        .is('cancelled_at', null)
        .order('send_after', { ascending: true })
        .limit(limit);
    if (error) throw new Error(error.message);

    const result: SendDueEmailsResult = { sent: 0, cancelled: 0, failed: 0 };
    const dueRows = (rows ?? []) as Array<
        OutboxRow & {
            token: string;
            purchase_id: string | null;
            to_email: string;
            subject: string;
            body_text: string;
            body_html: string | null;
        }
    >;
    for (const row of dueRows) {
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

        const mail = await sendMail({
            to: row.to_email,
            subject: row.subject,
            text: row.body_text,
            html: row.body_html ?? undefined,
        });
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

// ---------------------------------------------------------------------------
// diagnostics / admin status
// ---------------------------------------------------------------------------

/** Counts for the Email status card plus the five most recent error strings. */
export async function getEmailStatusSummary(db: SupabaseClient): Promise<EmailStatusSummary> {
    const { data: rows, error } = await db
        .from('email_outbox')
        .select('sent_at, cancelled_at, attempts, last_error, created_at');
    if (error) throw new Error(error.message);
    const all = (rows ?? []) as OutboxRow[];
    const pending = all.filter(
        (row) => row.sent_at === null && row.cancelled_at === null && row.attempts < 5,
    ).length;
    const sent = all.filter((row) => row.sent_at !== null).length;
    const failed = all.filter(
        (row) => row.sent_at === null && row.cancelled_at === null && row.attempts >= 5,
    ).length;
    const lastErrors = all
        .filter((row): row is OutboxRow & { last_error: string } =>
            typeof row.last_error === 'string' && row.last_error.length > 0)
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
        .slice(0, 5)
        .map((row) => row.last_error);
    return { pending, sent, failed, lastErrors };
}

/** Latest email delivery state for each requested token. */
export async function getEmailStatusesForTokens(
    db: SupabaseClient,
    tokens: string[],
): Promise<Map<string, TokenEmailStatus>> {
    const result = new Map<string, TokenEmailStatus>();
    if (tokens.length === 0) return result;
    const { data, error } = await db
        .from('email_outbox')
        .select('token, sent_at, cancelled_at, attempts, last_error, created_at')
        .in('token', tokens);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<OutboxRow & { token: string; created_at: string }>;
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const row of rows) {
        if (result.has(row.token)) continue;
        if (row.sent_at !== null) {
            result.set(row.token, { status: 'sent' });
        } else if (row.cancelled_at !== null) {
            result.set(row.token, { status: 'none' });
        } else if (row.attempts >= 5) {
            result.set(row.token, { status: 'failed', lastError: row.last_error ?? undefined });
        } else {
            result.set(row.token, {
                status: 'pending',
                ...(row.last_error ? { lastError: row.last_error } : {}),
            });
        }
    }
    return result;
}
