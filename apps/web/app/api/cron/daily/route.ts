import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { runAutomatedAnalysis } from '@/lib/db/analysis';
import { syncFixtures, type SyncFixturesResult } from '@/lib/sync-fixtures';
import { settleMatches } from '@/lib/settle';
import { isCronRequestAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/cron/daily — once-a-day job (Vercel Cron, 05:00 UTC):
//   1. sync today's fixtures into the matches table (new rows start as
//      tier 'unassigned' af-* matches)
//   2. settle finished af-* picks from past matches
//   3. run the same automatic analysis as the "Run Analysis" button for today
//      (runAutomatedAnalysis reads the stored matches; it syncs itself when
//      none are stored)
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

    const date = new Date().toISOString().split('T')[0];

    // 1. Sync today's fixtures (best effort: analysis syncs when needed).
    let sync: SyncFixturesResult | null = null;
    let syncError: string | null = null;
    try {
        sync = await syncFixtures(db, date);
    } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
        console.error('[Cron Daily] Sync failed:', error);
    }

    let settle;
    try {
        settle = await settleMatches(db);
    } catch (error) {
        console.error('[Cron Daily] Settlement failed:', error);
        return NextResponse.json(
            {
                date,
                error: 'Settlement failed',
                detail: error instanceof Error ? error.message : String(error),
                sync,
                syncError,
            },
            { status: 500 },
        );
    }

    let analysis: Awaited<ReturnType<typeof runAutomatedAnalysis>> | null = null;
    let analysisError: string | null = null;
    try {
        analysis = await runAutomatedAnalysis(db, { date });
    } catch (error) {
        analysisError = error instanceof Error ? error.message : String(error);
        console.error('[Cron Daily] Analysis failed:', error);
    }

    return NextResponse.json({
        date,
        ok: analysisError === null,
        sync,
        syncError,
        settle,
        analysis,
        analysisError,
    });
}
