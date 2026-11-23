import { MatchData, LeagueInfo } from '@trophy-games/shared';
import { createDb } from './db/client';
import { getAll, saveAll } from './db/matches';
import { getAllLeagues } from './db/leagues';

export interface ScrapedData {
    leagues: LeagueInfo[];
    matches: MatchData[];
    lastUpdated: string;
}

export async function saveMatches(matches: MatchData[], leagues: LeagueInfo[] = []) {
    const db = createDb();
    if (!db || !matches.length) return;

    console.log(`[Storage] Saving ${matches.length} matches to Supabase...`);
    try {
        await saveAll(db, matches, leagues);
    } catch (error) {
        console.error('[Storage] Save matches failed:', error);
    }
}

export async function loadData(): Promise<ScrapedData> {
    const db = createDb();
    if (!db) {
        console.warn('[Storage] Database not configured. Using empty data.');
        return { leagues: [], matches: [], lastUpdated: '' };
    }

    try {
        const [rawMatches, rawLeagues] = await Promise.all([
            getAll(db, 500),
            getAllLeagues(db),
        ]);

        const matches = rawMatches as MatchData[];
        const leagues = rawLeagues as LeagueInfo[];

        console.log(`[Storage] Loaded ${matches.length} matches and ${leagues.length} leagues.`);

        return {
            leagues: leagues,
            matches: matches,
            lastUpdated: new Date().toISOString(),
        };
    } catch (error) {
        console.error('[Storage] Load from database failed:', error);
        return { leagues: [], matches: [], lastUpdated: '' };
    }
}

export async function getMatchCount(): Promise<{ totalMatches: number }> {
    const db = createDb();
    if (!db) {
        return { totalMatches: 0 };
    }

    try {
        const { data } = await db.from('matches').select('id', { count: 'exact' });
        const count = (data as { count: number | null } | null)?.count ?? 0;
        return {
            totalMatches: count,
        };
    } catch (error) {
        console.error('[Storage] Get match count failed:', error);
        return { totalMatches: 0 };
    }
}

