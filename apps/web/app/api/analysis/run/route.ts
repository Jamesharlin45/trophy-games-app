import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { DeepSeekApiError, processRunChunk } from '@/lib/db/analysis-run';

// POST /api/analysis/run - Reworked Run Analysis: analyse stored Supabase
// matches (Daily = selected date, Weekly = the week of the selected date)
// with DeepSeek web search. The page calls this repeatedly until
// state === 'complete'.
//
// maxDuration is the maximum the Hobby Vercel plan allows (60s).
export const maxDuration = 60;

export async function POST(req: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const body = (await req.json()) as {
            date?: string;
            analysisType?: 'daily' | 'weekly';
            rerun?: boolean;
        };
        if (!body.date) {
            return NextResponse.json({ error: 'Missing date' }, { status: 400 });
        }

        const outcome = await processRunChunk(db, body.date, body.analysisType ?? 'daily', body.rerun ?? false);
        return NextResponse.json(outcome);
    } catch (error) {
        if (error instanceof DeepSeekApiError) {
            return NextResponse.json({ error: error.message, code: 'DEEPSEEK_ERROR' }, { status: error.status });
        }
        console.error('[Analysis API] Run failed:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Analysis failed' },
            { status: 500 },
        );
    }
}
