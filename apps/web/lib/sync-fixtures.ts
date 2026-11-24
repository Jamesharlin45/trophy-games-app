/**
 * Server-side fixture sync: pull today's + the next 2 days' fixtures from
 * API-Football (the same fetch as the admin "Load from fixtures" flow —
 * lib/api-football.ts `fetchFixturesDetailed`) and upsert them into the
 * Supabase `matches` table by `external_id` (`fixture-<api id>`).
 *
 * New rows: tier 'unassigned', status Scheduled, is_history false, score ''.
 * They are plain DB rows, so they never fire alerts or push notifications.
 * Existing rows: only kickoff, status and score are updated — tier, odds,
 * aiPrediction, result and isTrending are never touched.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFixturesDetailed, type ApiFootballFixture } from './api-football';
import { createDb } from './db/client';
import type { MatchRow } from './db/types';

export interface FixturesSyncSummary {
    /** The date range this run covers (today + the next days). */
    date: string | null;
    /** Fixtures the API returned for the dates we fetched. */
    fetched: number;
    /** New af-* rows stored. */
    inserted: number;
    /** Updated rows (kickoff/status/score). */
    updated: number;
    /** API fixtures deliberately not written (duplicates/missing ids). */
    skipped: number;
    /** ISO timestamp of this run; null when the sync was throttled. */
    syncedAt: string | null;
    /** Errors from upserts / the sync-state write. */
    errors: string[];
    /** The API's x-ratelimit-requests-remaining value after the last
     * fetch, when the API sent a header. */
    remaining: number | null;
}

/** Backwards-compatible alias used by the cron/admin routes. */
export type SyncFixturesResult = FixturesSyncSummary;

/** Stop syncing when fewer than this many requests remain. */
const MIN_REQUESTS_REMAINING = 10;
/** Fetch today + the next 2 days (UTC). */
const SYNC_DAYS = 3;

function utcDate(daysFromNow: number): string {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysFromNow),
    ).toISOString().slice(0, 10);
}

function externalIdFor(fixture: ApiFootballFixture): string {
    return `fixture-${fixture.id}`;
}

/** API status → app status. 'NS' (not started) maps to 'Scheduled' to match
 * the vocabulary used by manual matches; other statuses pass through. */
function statusForSync(status: string): string {
    const trimmed = status.trim();
    return trimmed === '' || trimmed === 'NS' ? 'Scheduled' : trimmed;
}

/** Row shape for the INSERT of a new match (the `matches` table: external_id,
 * home_team, away_team, league, kickoff, score, status + the sync-owned
 * tier/is_history/match_date). */
interface NewMatchRow {
    external_id: string;
    home_team: string;
    away_team: string;
    league: string;
    kickoff: string;
    score: string;
    status: string;
    tier: 'unassigned';
    is_history: false;
    match_date: string | null;
}

function newMatchRow(fixture: ApiFootballFixture): NewMatchRow {
    const date = fixture.date.trim();
    return {
        external_id: externalIdFor(fixture),
        home_team: fixture.homeTeam.name.trim(),
        away_team: fixture.awayTeam.name.trim(),
        league: fixture.league.name.trim(),
        kickoff: date,
        score: '',
        status: statusForSync(fixture.status),
        tier: 'unassigned',
        is_history: false,
        match_date: date.length >= 10 ? date.slice(0, 10) : null,
    };
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

async function insertNewRows(db: SupabaseClient, rows: NewMatchRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    let inserted = 0;
    for (const batch of chunk(rows, 500)) {
        const { error } = await db.from('matches').insert(batch);
        if (error) throw new Error(`Failed to insert fixtures: ${error.message}`);
        inserted += batch.length;
    }
    return inserted;
}

/** Stamp the singleton `sync_state` row (used by the admin Matches page to
 * decide whether to auto-sync on open). Returns errors instead of throwing so
 * callers can still report the sync summary. */
async function stampLastSyncedAt(db: SupabaseClient): Promise<string[]> {
    const errors: string[] = [];
    const { error } = await db
        .from('sync_state')
        .upsert({ id: 1, last_synced_at: new Date().toISOString() });
    if (error) errors.push(`Failed to store last_synced_at: ${error.message}`);
    return errors;
}

/** When was the last fixture sync (the singleton `sync_state` row)? */
export async function readLastSyncedAt(): Promise<string | null> {
    const db = createDb();
    if (!db) return null;
    const { data } = await db.from('sync_state').select('last_synced_at').eq('id', 1).limit(1);
    const row = (data ?? [])[0] as { last_synced_at?: string } | undefined;
    return row?.last_synced_at ?? null;
}

export async function syncFixtures(
    dbArg?: SupabaseClient,
    _date?: string,
): Promise<FixturesSyncSummary> {
    const db = dbArg ?? createDb();
    if (!db) {
        throw new Error('Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let fetched = 0;
    let remaining: number | null = null;
    const errors: string[] = [];

    for (let offset = 0; offset < SYNC_DAYS; offset += 1) {
        const date = utcDate(offset);
        const result = await fetchFixturesDetailed(date);
        remaining = result.rateLimitRemaining;
        const allFixtures = result.fixtures;
        fetched += allFixtures.length;

        // Budget guard: stop syncing once the API is nearly out of requests.
        // There is deliberately no retry loop.
        if (remaining !== null && remaining < MIN_REQUESTS_REMAINING) break;
        if (allFixtures.length === 0) continue;

        const externalIds = allFixtures
            .map((fixture) => externalIdFor(fixture))
            .filter((id) => id !== '');

        // Existing rows keyed by external_id (the row id is needed for updates).
        const existingById = new Map<string, MatchRow>();
        for (const batch of chunk(externalIds, 500)) {
            const { data } = await db
                .from('matches')
                .select('id, external_id')
                .in('external_id', batch);
            for (const row of data ?? []) {
                const externalId = row?.external_id;
                if (typeof externalId === 'string' && row?.id != null) {
                    existingById.set(externalId, row as MatchRow);
                }
            }
        }

        // Insert new ones (tier 'unassigned', status Scheduled, ...).
        const seen = new Set<string>();
        const newRows: NewMatchRow[] = [];
        for (const fixture of allFixtures) {
            const externalId = externalIdFor(fixture);
            if (externalId === '' || seen.has(externalId)) {
                skipped += 1;
                continue;
            }
            seen.add(externalId);
            if (existingById.has(externalId)) continue;
            newRows.push(newMatchRow(fixture));
        }
        inserted += await insertNewRows(db, newRows);

        // Update kickoff/status/score of matches we already know. Tier, odds,
        // aiPrediction, result and isTrending are intentionally untouched.
        for (const fixture of allFixtures) {
            const externalId = externalIdFor(fixture);
            const dbRow = externalId === '' ? undefined : existingById.get(externalId);
            if (!dbRow) continue;
            const { error } = await db
                .from('matches')
                .update({
                    kickoff: fixture.date,
                    status: statusForSync(fixture.status),
                    score: '',
                })
                .eq('id', dbRow.id);
            if (error) {
                errors.push(`Failed to update fixture ${externalId}: ${error.message}`);
                continue;
            }
            updated += 1;
        }
    }

    errors.push(...(await stampLastSyncedAt(db)));
    return {
        date: utcDate(0),
        fetched,
        inserted,
        updated,
        skipped,
        syncedAt: new Date().toISOString(),
        errors,
        remaining,
    };
}
