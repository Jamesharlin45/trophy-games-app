import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { sendDueEmails } from '@/lib/db/email-outbox';
import { isCronRequestAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/cron/send-emails — send due outbox rows (token emails to buyers).
// Same cron auth as the other cron routes: the x-cron-secret header (GitHub
// Actions) or Authorization: Bearer <CRON_SECRET> (Vercel Cron). Registered as
// a once-a-day fallback in vercel.json; every /api/app/* endpoint also
// triggers it opportunistically.
export async function GET(req: Request) {
    if (!process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
    }
    if (!isCronRequestAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const result = await sendDueEmails(db);
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        console.error('[Cron SendEmails] Failed:', error);
        return NextResponse.json(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
