import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import {
    enqueueTokenEmail,
    isValidEmail,
    maskEmail,
    normalizeEmail,
    recordEmailFailure,
} from '@/lib/db/email-outbox';
import { redactSmtpSecrets } from '@/lib/email-diagnostics';
import { scheduleTokenEmail } from '@/lib/email-opportunistic';

export const dynamic = 'force-dynamic';

interface AccessTokenRow {
    type: 'vip' | 'paid';
    expires_at: string | null;
}

/** POST /api/admin/tokens/email — Send token by email / Resend.
 * The address is supplied by the admin (prefilled from the request or the
 * purchase). The token value is never logged. */
export async function POST(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    let body: { token?: unknown; email?: unknown } = {};
    try {
        body = (await request.json()) as { token?: unknown; email?: unknown };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });

    try {
        const { data, error } = await db
            .from('access_tokens')
            .select('type, expires_at')
            .eq('token', token)
            .limit(1);
        if (error) throw new Error(error.message);
        const row = (data ?? [])[0] as AccessTokenRow | undefined;
        if (!row) return NextResponse.json({ error: 'Token not found' }, { status: 404 });

        let queued: Awaited<ReturnType<typeof enqueueTokenEmail>>;
        try {
            queued = await enqueueTokenEmail(db, {
                token,
                toEmail: email,
                tier: row.type,
                expiresAt: row.expires_at,
                dueNow: true,
                allowResend: true,
            });
        } catch (error) {
            const reason = redactSmtpSecrets(
                error instanceof Error ? error.message : 'Failed to queue email',
            );
            await recordEmailFailure(db, {
                token,
                toEmail: email,
                tier: row.type,
                expiresAt: row.expires_at,
                reason,
            });
            queued = { success: false, reason };
        }
        if (!queued.success) {
            return NextResponse.json({
                error: 'Failed to send email',
                emailStatus: 'failed',
                email: maskEmail(email),
                emailError: redactSmtpSecrets(queued.reason),
            }, { status: 500 });
        }
        scheduleTokenEmail(token);
        return NextResponse.json({
            success: true,
            action: queued.action,
            email: maskEmail(email),
            emailStatus: queued.action === 'already_sent' ? 'sent' : 'queued',
        });
    } catch (error) {
        console.error('[API] Queue token email failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to queue email' }, { status: 500 });
    }
}
