import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFixtureResults, type ApiFootballFixtureResult } from './api-football';
import type { MatchRow } from './db/types';

/** Result of grading one pick from its market and the 90-minute score. */
export type SettlementOutcome = 'won' | 'lost' | 'void';

/** Fixtures whose picks are settled: full time, after extra time, or on
 * penalties. The score used for grading is always the 90-minute score. */
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

/** Postponed, cancelled and abandoned fixtures void the pick. */
const VOID_STATUSES = new Set(['PST', 'CANC', 'ABD']);

/** Only settle picks whose kickoff is at least this old. */
export const SETTLE_AFTER_MS = 3 * 60 * 60 * 1000;

/** API-Football accepts at most 20 ids per request. */
const MAX_IDS_PER_REQUEST = 20;

function normalizeMarket(market: string): string {
    return market.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Grade a pick from its market and the 90-minute score.
 * Returns null when the market is not one the app can grade.
 */
export function gradePick(
    market: string,
    homeScore: number,
    awayScore: number,
): SettlementOutcome | null {
    const normalized = normalizeMarket(market);
    const total = homeScore + awayScore;

    switch (normalized) {
        case 'home win':
            return homeScore > awayScore ? 'won' : 'lost';
        case 'away win':
            return awayScore > homeScore ? 'won' : 'lost';
        case 'draw':
            return homeScore === awayScore ? 'won' : 'lost';
        case 'double chance 1x':
            return homeScore >= awayScore ? 'won' : 'lost';
        case 'double chance x2':
            return awayScore >= homeScore ? 'won' : 'lost';
        case 'over 2.5 goals':
            return total > 2.5 ? 'won' : 'lost';
        case 'under 2.5 goals':
            return total < 2.5 ? 'won' : 'lost';
        case 'both teams to score':
            return homeScore > 0 && awayScore > 0 ? 'won' : 'lost';
        default:
            return null;
    }
}

/** One settled match, as reported to the caller. */
export interface SettledMatch {
    externalId: string;
    market: string;
    outcome: SettlementOutcome;
    homeScore: number | null;
    awayScore: number | null;
    status: string;
}

/** Outcome of one settlement run. */
export interface SettleMatchesResult {
    /** af- picks older than the cutoff and not yet settled. */
    candidates: number;
    /** Fixtures returned by API-Football for those picks. */
    fetched: number;
    settled: number;
    won: number;
    lost: number;
    void: number;
    /** Picks left for a later run (unfinished, missing fixture, bad market). */
    skipped: number;
    errors: string[];
    matches: SettledMatch[];
}

/** Split a list into batches of at most `size` items. */
function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

function fixtureIdFromExternalId(externalId: string | null): number | null {
    if (!externalId || !externalId.startsWith('af-')) return null;
    const id = Number(externalId.slice(3));
    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Settle finished `af-*` picks.
 *
 * Finds matches with an external id starting `af-`, not in history, whose
 * kickoff is more than 3 hours ago; fetches their fixtures from API-Football
 * in batches of 20; and for FT/AET/PEN fixtures stores the status and the
 * 90-minute score, grades the pick from its market, and sets `is_history`.
 * Postponed/cancelled/abandoned fixtures are voided. Unfinished fixtures are
 * left untouched for the next run. Only unsettled matches are selected, so
 * the routine is idempotent.
 */
export async function settleMatches(db: SupabaseClient): Promise<SettleMatchesResult> {
    const errors: string[] = [];
    const settled: SettledMatch[] = [];
    let skipped = 0;

    const cutoff = new Date(Date.now() - SETTLE_AFTER_MS).toISOString();
    const { data, error } = await db
        .from('matches')
        .select('*')
        .like('external_id', 'af-%')
        .eq('is_history', false)
        .lt('kickoff', cutoff)
        .order('kickoff', { ascending: true })
        .limit(500);

    if (error) throw new Error(`Failed to load picks to settle: ${error.message}`);

    const rows = (data ?? []) as MatchRow[];
    const candidates = rows.length;
    if (candidates === 0) {
        return { candidates: 0, fetched: 0, settled: 0, won: 0, lost: 0, void: 0, skipped: 0, errors, matches: settled };
    }

    // Fetch all fixtures, 20 ids per request.
    const idToRow = new Map<number, MatchRow>();
    for (const row of rows) {
        const id = fixtureIdFromExternalId(row.external_id);
        if (id === null) {
            skipped += 1;
            errors.push(`${row.external_id ?? row.id}: invalid external id`);
            continue;
        }
        idToRow.set(id, row);
    }

    const fixtures = new Map<number, ApiFootballFixtureResult>();
    const ids = [...idToRow.keys()];
    for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
        try {
            const results = await fetchFixtureResults(batch);
            for (const fixture of results) fixtures.set(fixture.id, fixture);
        } catch (fetchError) {
            errors.push(
                `fixtures ${batch.join('-')}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
            );
        }
    }

    const now = new Date().toISOString();

    for (const [id, row] of idToRow) {
        const fixture = fixtures.get(id);
        if (!fixture) {
            skipped += 1;
            errors.push(`${row.external_id}: fixture not returned by API-Football`);
            continue;
        }

        const status = fixture.status.trim().toUpperCase();
        const isVoid = VOID_STATUSES.has(status);
        const isFinished = FINISHED_STATUSES.has(status);
        if (!isVoid && !isFinished) {
            // Not finished yet: leave it for a later run.
            skipped += 1;
            continue;
        }

        const market = row.ai_prediction?.suggestedBet;
        if (!market) {
            skipped += 1;
            errors.push(`${row.external_id}: pick has no market to grade`);
            continue;
        }

        let outcome: SettlementOutcome;
        if (isVoid) {
            outcome = 'void';
        } else {
            if (fixture.homeScore === null || fixture.awayScore === null) {
                skipped += 1;
                errors.push(`${row.external_id}: finished fixture has no 90-minute score`);
                continue;
            }
            const graded = gradePick(market, fixture.homeScore, fixture.awayScore);
            if (!graded) {
                skipped += 1;
                errors.push(`${row.external_id}: market "${market}" cannot be graded`);
                continue;
            }
            outcome = graded;
        }

        const updates: Record<string, unknown> = {
            status,
            is_history: true,
            // 'void' has no value in the matches.result check constraint, so it
            // is stored as null; the full settlement lives in details.
            result: outcome === 'won' ? 'win' : outcome === 'lost' ? 'lose' : null,
            details: {
                ...(row.details ?? {}),
                settlement: {
                    outcome,
                    market,
                    homeScore: fixture.homeScore,
                    awayScore: fixture.awayScore,
                    finalHomeScore: fixture.finalHomeScore,
                    finalAwayScore: fixture.finalAwayScore,
                    status,
                    settledAt: now,
                },
            },
        };
        // Display the final score (extra time included, penalties excluded);
        // grading above used the 90-minute score.
        if (fixture.finalHomeScore !== null && fixture.finalAwayScore !== null) {
            updates.score = `${fixture.finalHomeScore}-${fixture.finalAwayScore}`;
        } else if (fixture.homeScore !== null && fixture.awayScore !== null) {
            updates.score = `${fixture.homeScore}-${fixture.awayScore}`;
        }

        const { error: updateError } = await db.from('matches').update(updates).eq('id', row.id);
        if (updateError) {
            errors.push(`${row.external_id}: ${updateError.message}`);
            continue;
        }

        settled.push({
            externalId: row.external_id ?? row.id,
            market,
            outcome,
            homeScore: fixture.homeScore,
            awayScore: fixture.awayScore,
            status,
        });
    }

    return {
        candidates,
        fetched: fixtures.size,
        settled: settled.length,
        won: settled.filter((m) => m.outcome === 'won').length,
        lost: settled.filter((m) => m.outcome === 'lost').length,
        void: settled.filter((m) => m.outcome === 'void').length,
        skipped,
        errors,
        matches: settled,
    };
}
