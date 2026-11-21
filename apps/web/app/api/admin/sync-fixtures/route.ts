import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { syncFixtures, type SyncFixturesResult } from '@/lib/sync-fixtures';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
        const result: SyncFixturesResult = await syncFixtures(db, date);
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Admin Sync Fixtures API] Failed to sync fixtures:', error);
        const message = error instanceof Error ? error.message : 'Failed to sync fixtures';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
