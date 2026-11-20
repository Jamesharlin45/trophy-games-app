import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { runAutomatedAnalysis } from '@/lib/db/analysis';
import { settleMatches } from '@/lib/settle';
import { isCronRequestAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/cron/daily — once-a-day job (Vercel Cron, 05:00 UTC):
//   1. settle finished af-* picks from past matches
//   2. run the same automatic analysis as the "Run Analysis" button for today
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
        settle,
        analysis,
        analysisError,
    });
}
