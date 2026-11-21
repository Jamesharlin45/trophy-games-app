import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { settleMatches } from '@/lib/settle';
import { isCronRequestAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/cron/settle — settle finished `af-*` picks from past matches.
// Same cron auth as /api/cron/sync (fail closed without CRON_SECRET) and
// intentionally not behind the Basic Auth in proxy.ts.
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
        const settle = await settleMatches(db);
        return NextResponse.json({ ok: true, settle });
    } catch (error) {
        console.error('[Cron Settle] Settlement failed:', error);
        return NextResponse.json(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
