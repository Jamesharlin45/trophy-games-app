import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { runAnalysis } from '@/lib/db/analysis';

// POST /api/analysis/run - Trigger DeepSeek analysis
export async function POST(req: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const body = (await req.json()) as { date?: string; analysisType?: 'daily' | 'weekly' };
        const { date, analysisType } = body;

        if (!date || !analysisType) {
            return NextResponse.json({ error: 'Missing date or analysisType' }, { status: 400 });
        }

        const result = await runAnalysis(db, { date, analysisType });
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Analysis API] Run failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Analysis failed' }, { status: 500 });
    }
}
