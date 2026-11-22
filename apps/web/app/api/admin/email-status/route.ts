import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getEmailStatusSummary } from '@/lib/db/email-outbox';
import { redactSmtpSecrets, smtpConfigFlags } from '@/lib/email-diagnostics';

export const dynamic = 'force-dynamic';

/** GET /api/admin/email-status — queue counts and recent errors.
 * Admin auth is enforced by the /api/admin matcher in proxy.ts. Only boolean
 * flags and redacted error strings are returned. */
export async function GET() {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }
    try {
        const summary = await getEmailStatusSummary(db);
        return NextResponse.json({
            ...summary,
            lastErrors: summary.lastErrors.map(redactSmtpSecrets),
            config: smtpConfigFlags(),
        });
    } catch (error) {
        console.error('[API] Email status failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to load email status' }, { status: 500 });
    }
}
