import { NextResponse, after } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { getPublishedFinishedMatches, toAppResult } from '@/lib/db/matches';
import type { DbMatch } from '@/lib/db/types';
import { syncResults } from '@/lib/sync-results';

export const dynamic = 'force-dynamic';

/** Response vocabulary of this endpoint — the app vocabulary
 * ('pending' | 'win' | 'lose' | 'draw'); void outcomes are excluded via
 * excludeVoid, so they never appear here. */
function historyResult(match: DbMatch) {
    return toAppResult(match.result);
}

/** Strike rate = won / (won + lost); void and pending are excluded. */
function strikeRateOf(matches: DbMatch[]): number {
    let won = 0;
    let lost = 0;
    for (const match of matches) {
        const result = historyResult(match);
        if (result === 'win') won += 1;
        else if (result === 'lose') lost += 1;
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
        const all = await getPublishedFinishedMatches(db, { excludeVoid: true });
        const since30 = addDaysUtc(date, -30);
        const dateMatches = all.filter((m) => m.matchDate === date);
        const recentMatches = all.filter((m) => {
            const md = m.matchDate ?? '';
            return md >= since30 && md <= date;
        });
        return NextResponse.json({
            matches: dateMatches.map((m) => ({ ...m, result: historyResult(m) })),
            strikeRate: strikeRateOf(dateMatches),
            strikeRate30d: strikeRateOf(recentMatches),
        });
    } catch (error) {
        console.error('[API App Matches History] Error:', error);
        return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
    }
}
