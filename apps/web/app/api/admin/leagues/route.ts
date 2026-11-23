import { NextResponse } from 'next/server';
import { MatchData } from '@trophy-games/shared';
import { deriveLeaguesFromMatches } from '@/lib/footystats';
import { createDb } from '@/lib/db/client';
import { getAll } from '@/lib/db/matches';

// GET - Leagues are derived from the matches (kept in sync with the data
// sync jobs), so web and mobile always show the same competitions.
export async function GET() {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const matches = await getAll(db, 1000);
        const leagues = deriveLeaguesFromMatches(matches as MatchData[]);
        return NextResponse.json(leagues);
    } catch (error) {
        console.error('[Admin Leagues API] Failed to fetch leagues:', error);
        return NextResponse.json({ error: 'Failed to fetch leagues' }, { status: 500 });
    }
}
