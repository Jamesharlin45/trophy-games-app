import { NextResponse } from 'next/server';
import { MatchData } from '@trophy-games/shared';
import { deriveLeaguesFromMatches } from '@/lib/footystats';
import { createDb } from '@/lib/db/client';
import { getAll } from '@/lib/db/matches';
import { getAllUsers } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

const empty = {
    totalLeagues: 0,
    totalMatches: 0,
    freeTips: 0,
    paidTips: 0,
    vipTips: 0,
    winRate: 0,
    lastUpdated: new Date().toISOString(),
};

// Stats computed from the matches table (kept in sync by the data sync jobs).
export async function GET() {
    const db = createDb();
    if (!db) {
        return NextResponse.json(empty);
    }

    try {
        const matchesList = await getAll(db, 1000);
        const leaguesList = deriveLeaguesFromMatches(matchesList as MatchData[]);

        const totalMatches = matchesList.length;
        const totalLeagues = leaguesList.length;
        const freeTips = matchesList.filter((m) => m.matchType === 'free').length;
        const paidTips = matchesList.filter((m) => m.matchType === 'paid').length;
        const vipTips = matchesList.filter((m) => m.matchType === 'vip').length;

        // Win rate = finished matches the home side won (mirrors the mobile Wins screen).
        const finished = matchesList.filter((m) => m.homeScore !== undefined && m.awayScore !== undefined);
        const homeWins = finished.filter((m) => (m.homeScore as number) > (m.awayScore as number)).length;
        const winRate = finished.length > 0 ? Math.round((homeWins / finished.length) * 100) : 0;

        const totalUsers = (await getAllUsers(db)).length;

        return NextResponse.json({
            totalLeagues,
            totalMatches,
            freeTips,
            paidTips,
            vipTips,
            winRate,
            totalUsers,
            lastUpdated: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[API Stats] Error:', error);
        return NextResponse.json(empty);
    }
}
