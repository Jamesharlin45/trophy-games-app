/**
 * Server-only: settle finished fixture results into the matches table.
 *
 * For stored matches whose external id is `af-<id>` and whose API-Football
 * fixture is finished (FT, AET, PEN) we set the app's finished status
 * vocabulary, store the final score in the `score` column and flag
 * `is_history = true`. Postponed/cancelled/abandoned fixtures (PST, CANC,
 * ABD, AWD, WO) get result 'void'. When `result` is empty and the pick can be
 * graded, `evaluatePick` decides won/lost/void and stores the result (the
 * admin is the fallback for ungradeable markets). Tier, odds and
 * ai_prediction are never touched.
 *
 * Budget: the API-Football free plan allows only yesterday/today/tomorrow and
 * 100 requests/day; syncResults fetches at most one request per date (the
 * cached helper) and stops when fewer than BUDGET_MIN_REMAINING calls remain.
 *
 * Throttle: sync_state.results_synced_at records the last run; the function
 * returns early when it is younger than RESULTS_SYNC_MIN_INTERVAL_MS unless
 * `force` is set (used by the daily cron and the admin "Refresh results"
 * button).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFixtures, type ApiFootballFixture } from './api-football';
import { getById } from './db/matches';
import type { DbMatch } from './db/types';
import { evaluatePick } from './evaluate-pick';

/** Fixtures whose picks are settled: full time, after extra time, or on
 * penalties. (Mirrors lib/settle.ts.) */
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

/** Postponed, cancelled and abandoned fixtures void the pick. */
const VOID_STATUSES = new Set(['PST', 'CANC', 'ABD', 'AWD', 'WO']);

/** App status vocabulary for the settled statuses above. */
function finishedStatusLabel(status: string): string {
    return status === 'FT' ? 'FT' : 'Finished';
}

/** App status vocabulary for voided fixtures. */
const VOID_STATUS_LABELS: Record<string, string> = {
    PST: 'Postponed',
    AWD: 'Postponed',
    CANC: 'Cancelled',
    WO: 'Cancelled',
    ABD: 'Abandoned',
};

function voidStatusLabel(status: string): string {
    return VOID_STATUS_LABELS[status] ?? status;
}

/** Stops the sync when fewer than this many plan calls remain. */
const PLAN_MAX_CALLS_PER_DAY = 100;
const BUDGET_MIN_REMAINING = 10;

let callsUsed = 0;

function remainingCalls(): number {
    return PLAN_MAX_CALLS_PER_DAY - callsUsed;
}

/** Minimum time between sync runs; state is kept in the sync_state table. */
export const RESULTS_SYNC_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000;

export interface SyncResultsResult {
    /** True when the throttle skipped the run. */
    throttled: boolean;
    /** Dates the helper was called for. */
    dates: string[];
    /** Fixtures returned by the API for those dates. */
    fetched: number;
    /** Stored rows updated (finished + voided). */
    updated: number;
    /** Rows updated for finished fixtures. */
    finished: number;
    /** Rows set to result 'void' for cancelled/postponed/abandoned fixtures. */
    voided: number;
    /** Results set by grading (won/lost/void). */
    resultsSet: number;
    errors: string[];
}

function utcDateMinus(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

/** UTC YYYY-MM-DD strings, oldest first, for [yesterday, today]. */
function syncDates(): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = utcDateMinus(1);
    return yesterday === today ? [today] : [yesterday, today];
}

/** Pick text from the stored AI prediction (pick, then suggestedBet, then
 * prediction — same order as settleMatches' market lookup). */
function pickTextOf(match: DbMatch): string {
    const ai = match.aiPrediction;
    if (!ai) return '';
    return ai.pick ?? ai.suggestedBet ?? ai.prediction ?? '';
}

function isEmptyResult(result: DbMatch['result']): boolean {
    return result === null || result === undefined || result === 'pending';
}

async function lastResultsSyncedAt(db: SupabaseClient): Promise<string | null> {
    const { data, error } = await db
        .from('sync_state')
        .select('results_synced_at')
        .eq('id', 1)
        .limit(1);
    if (error) {
        console.warn('[SyncResults] sync_state read failed:', error.message);
        return null;
    }
    return data?.[0]?.results_synced_at ?? null;
}

async function resultsRecentlySynced(db: SupabaseClient): Promise<boolean> {
    const last = await lastResultsSyncedAt(db);
    if (!last) return false;
    return Date.now() - new Date(String(last)).getTime() < RESULTS_SYNC_MIN_INTERVAL_MS;
}

async function recordResultsSynced(db: SupabaseClient): Promise<void> {
    // Production schema: sync_state is the singleton row with id = 1 and a
    // NOT NULL last_synced_at; results_synced_at is the nullable column used
    // as the results-sync throttle marker.
    const now = new Date();
    const { error } = await db
        .from('sync_state')
        .upsert(
            { id: 1, last_synced_at: now, results_synced_at: now },
            { onConflict: 'id' },
        );
    if (error) console.warn('[SyncResults] sync_state write failed:', error.message);
}

async function updateRow(
    db: SupabaseClient,
    stored: DbMatch,
    updates: Record<string, unknown>,
    errors: string[],
): Promise<boolean> {
    const { error } = await db.from('matches').update(updates).eq('id', stored._id);
    if (error) {
        errors.push(`${stored.id}: ${error.message}`);
        return false;
    }
    return true;
}

function emptyResult(): SyncResultsResult {
    return { throttled: false, dates: [], fetched: 0, updated: 0, finished: 0, voided: 0, resultsSet: 0, errors: [] };
}

/**
 * Sync yesterday + today. At most one API-Football request per date
 * (the cached helper); stops fetching when the plan budget guard says fewer
 * than BUDGET_MIN_REMAINING calls remain.
 */
export async function syncResults(db: SupabaseClient, options: { force?: boolean } = {}): Promise<SyncResultsResult> {
    if (!options.force && (await resultsRecentlySynced(db))) {
        return { ...emptyResult(), throttled: true };
    }

    const result: SyncResultsResult = emptyResult();

    const dates = syncDates();
    result.dates = dates;

    const fixturesByDate = new Map<string, ApiFootballFixture[]>();
    for (const date of dates) {
        if (remainingCalls() < BUDGET_MIN_REMAINING) break;
        try {
            const fixtures = await fetchFixtures(date);
            callsUsed += 1;
            fixturesByDate.set(date, fixtures);
            result.fetched += fixtures.length;
        } catch (error) {
            callsUsed += 1;
            result.errors.push(`fixtures ${date}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    for (const fixtures of fixturesByDate.values()) {
        for (const fixture of fixtures) {
            const stored = await getById(db, `af-${fixture.id}`);
            if (!stored) continue;

            const status = (fixture.status || '').trim().toUpperCase();

            if (FINISHED_STATUSES.has(status)) {
                const homeScore = fixture.homeScore;
                const awayScore = fixture.awayScore;
                const finalHome = fixture.finalHomeScore ?? homeScore;
                const finalAway = fixture.finalAwayScore ?? awayScore;

                const updates: Record<string, unknown> = {
                    status: finishedStatusLabel(status),
                    is_history: true,
                };
                if (finalHome !== null && finalHome !== undefined && finalAway !== null && finalAway !== undefined) {
                    updates.score = `${finalHome}-${finalAway}`;
                }

                let storedResult: 'none' | 'win' | 'lose' | 'void' = 'none';
                if (isEmptyResult(stored.result)) {
                    const outcome = evaluatePick(
                        pickTextOf(stored),
                        stored.homeTeam,
                        stored.awayTeam,
                        homeScore ?? finalHome ?? null,
                        awayScore ?? finalAway ?? null,
                    );
                    if (outcome !== null) {
                        storedResult = outcome === 'won' ? 'win' : outcome === 'lost' ? 'lose' : 'void';
                        updates.result = storedResult;
                    }
                }

                if (!(await updateRow(db, stored, updates, result.errors))) continue;
                result.updated += 1;
                result.finished += 1;
                if (storedResult !== 'none') result.resultsSet += 1;
            } else if (VOID_STATUSES.has(status)) {
                // Void picks settle on the update; never overwrite an admin
                // result.
                const updates: Record<string, unknown> = { status: voidStatusLabel(status) };
                if (isEmptyResult(stored.result)) {
                    updates.result = 'void';
                    updates.is_history = true;
                }
                if (!(await updateRow(db, stored, updates, result.errors))) continue;
                result.updated += 1;
                result.voided += 1;
                if (updates.result) result.resultsSet += 1;
            }
        }
    }

    await recordResultsSynced(db);
    return result;
}
