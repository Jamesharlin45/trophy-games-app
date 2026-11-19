import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getById } from '@/lib/db/matches';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const matchId = searchParams.get('matchId');
    if (!matchId) {
        return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const db = createDb();
    if (!db) return NextResponse.json(null);

    try {
        return NextResponse.json(await getById(db, matchId));
    } catch (error) {
        console.error('[API App Matches ById] Error:', error);
        return NextResponse.json({ error: 'Failed to load match' }, { status: 500 });
    }
}
