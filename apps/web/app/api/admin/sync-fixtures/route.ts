import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { readLastSyncedAt, syncFixtures, type FixturesSyncSummary } from '@/lib/sync-fixtures';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET — Run the fixture sync now (the same function the cron route and the
// admin Matches page's auto-sync use). The page reads matches from the
// database first, so new rows are visible as soon as the sync lands.
export async function GET() {
    const summary = await syncFixtures();
    const lastSyncedAt = await readLastSyncedAt();
    return NextResponse.json({ ...summary, lastSyncedAt });
}

// POST /api/admin/sync-fixtures — sync one date's fixtures into the matches
// table ("fixtures first" style). Idempotent and throttled to once per 3
// hours per date by syncFixtures.
export async function POST(req: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    try {
        const body = (await req.json()) as { date?: string };
        const date = body.date?.trim();
        if (!date) {
            return NextResponse.json({ error: 'date is required' }, { status: 400 });
        }
        const result: FixturesSyncSummary = await syncFixtures(db, date);
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Admin Sync Fixtures API] Failed to sync fixtures:', error);
        const message = error instanceof Error ? error.message : 'Failed to sync fixtures';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
