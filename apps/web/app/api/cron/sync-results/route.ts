import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { syncResults } from '@/lib/sync-results';
import { isCronRequestAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET /api/cron/sync-results — once-a-day job (Vercel Cron, registered in
// vercel.json). Settles finished fixture results into the matches table.
// Same auth as the other cron routes (Authorization: Bearer <CRON_SECRET>).
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
        const result = await syncResults(db, { force: true });
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        console.error('[Cron Sync Results] Failed:', error);
        return NextResponse.json(
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}
