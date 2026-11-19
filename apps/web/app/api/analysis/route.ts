import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getByDate } from '@/lib/db/analysis';

export const dynamic = 'force-dynamic';

// GET /api/analysis?date=YYYY-MM-DD - Get analysis for a specific date
export async function GET(req: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const { searchParams } = new URL(req.url);
        const date = searchParams.get('date');

        if (!date) {
            return NextResponse.json({ error: 'Missing date parameter' }, { status: 400 });
        }

        const result = await getByDate(db, date);
        return NextResponse.json(result || { notFound: true });
    } catch (error) {
        console.error('[Analysis API] Get failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch analysis' }, { status: 500 });
    }
}
