import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getByDate } from '@/lib/db/matches';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    if (!date) {
        return NextResponse.json({ error: 'date is required' }, { status: 400 });
    }

    const db = createDb();
    if (!db) return NextResponse.json([]);

    try {
        return NextResponse.json(await getByDate(db, date));
    } catch (error) {
        console.error('[API App Matches ByDate] Error:', error);
        return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
    }
}
