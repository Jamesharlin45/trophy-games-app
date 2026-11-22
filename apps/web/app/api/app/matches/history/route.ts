import { NextResponse, after } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { getPublishedFinishedMatches } from '@/lib/db/matches';
import type { DbMatch, MatchResult } from '@/lib/db/types';
import { syncResults } from '@/lib/sync-results';

export const dynamic = 'force-dynamic';

/** Response vocabulary of this endpoint: 'won' | 'lost' | 'void' | 'pending'.
 * The stored vocabulary is 'win' | 'lose' | 'void' | null | 'pending' (the DB
 * check constraint only allows win/lose/draw/pending + void). */
type HistoryResult = 'won' | 'lost' | 'void' | 'pending';

function toHistoryResult(result: MatchResult | null | undefined): HistoryResult {
    if (result === 'win') return 'won';
    if (result === 'lose') return 'lost';
    if (result === 'void') return 'void';
    return 'pending';
}

/** Strike rate = won / (won + lost); void and pending are excluded. */
function strikeRateOf(matches: DbMatch[]): number {
    let won = 0;
    let lost = 0;
    for (const match of matches) {
        const result = toHistoryResult(match.result);
        if (result === 'won') won += 1;
        else if (result === 'lost') lost += 1;
    }
    const denominator = won + lost;
    return denominator > 0 ? Math.round((won / denominator) * 100) : 0;
}

function addDaysUtc(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
    triggerDueEmailsIfDue();
    const db = createDb();
    if (!db) return NextResponse.json([]);

    const { searchParams } = new URL(request.url);
    const rawDate = searchParams.get('date');
    const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);

    // Opportunistic results sync (throttled inside syncResults to once per 3
    // hours by sync_state); after() so the response is not delayed.
    after(async () => {
        try {
            await syncResults(db);
        } catch (error) {
            console.error('[API App Matches History] Opportunistic results sync failed:', error);
        }
    });

    try {
        const all = await getPublishedFinishedMatches(db);
        const since30 = addDaysUtc(date, -30);
        const dateMatches = all.filter((m) => m.matchDate === date);
        const recentMatches = all.filter((m) => {
            const md = m.matchDate ?? '';
            return md >= since30 && md <= date;
        });
        return NextResponse.json({
            matches: dateMatches.map((m) => ({ ...m, result: toHistoryResult(m.result) })),
            strikeRate: strikeRateOf(dateMatches),
            strikeRate30d: strikeRateOf(recentMatches),
        });
    } catch (error) {
        console.error('[API App Matches History] Error:', error);
        return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
    }
}
