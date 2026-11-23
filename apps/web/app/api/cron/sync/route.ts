import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { syncFixtures, type SyncFixturesResult } from '@/lib/sync-fixtures';
import { isCronRequestAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Status of one date's sync, including errors the route records itself. */
export interface CronSyncDateResult extends SyncFixturesResult {
    error?: string;
}

// GET /api/cron/sync — sync today's and tomorrow's fixtures into the
// matches table (new rows start as tier 'unassigned' af-* matches).
//
// Uses the existing cron auth (fail closed without CRON_SECRET): the
// x-cron-secret header (GitHub Actions) or Bearer CRON_SECRET (Vercel Cron).
// Not behind the Basic Auth in proxy.ts — cron callers are outside the
// admin area by design.
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

    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const results: CronSyncDateResult[] = [];
    let ok = true;
    for (const date of [today, tomorrow]) {
        try {
            results.push(await syncFixtures(db, date));
        } catch (error) {
            ok = false;
            results.push({
                date,
                fetched: 0,
                inserted: 0,
                updated: 0,
                skipped: 0,
                syncedAt: null,
                errors: [],
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return NextResponse.json({ ok, results });
}
