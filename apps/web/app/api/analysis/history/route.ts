import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getAll } from '@/lib/db/analysis';

// GET /api/analysis/history - Get all analysis results
export async function GET() {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const results = await getAll(db, 50);
        return NextResponse.json(results);
    } catch (error) {
        console.error('[Analysis API] History failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch history' }, { status: 500 });
    }
}
