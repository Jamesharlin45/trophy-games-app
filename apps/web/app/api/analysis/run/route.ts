import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { runAutomatedAnalysis } from '@/lib/db/analysis';

// POST /api/analysis/run - Automated daily picks from API-Football
export const maxDuration = 60;

export async function POST(req: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const body = (await req.json()) as { date?: string; analysisType?: 'daily' | 'weekly' };
        const { date } = body;

        if (!date) {
            return NextResponse.json({ error: 'Missing date' }, { status: 400 });
        }

        const result = await runAutomatedAnalysis(db, { date });
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Analysis API] Run failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Analysis failed' }, { status: 500 });
    }
}
