import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFixtures, type ApiFootballFixture } from './api-football';
import { getById, utcMatchDate } from './db/matches';
import type { DbMatch } from './db/types';

/** Sync window: syncFixtures runs at most once per date within this period
 * (state is kept in the fixture_sync_log table). */
export const SYNC_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000;

export interface SyncFixturesResult {
    date: string;
    /** Fixtures the API returned for the date (0 when throttled). */
    fetched: number;
    /** New af-* rows stored. */
    inserted: number;
    /** Stored af-* rows refreshed from the API. */
    updated: number;
    /** Rows left untouched: published, analysed, or manually edited. */
    skipped: number;
    /** ISO timestamp of this run; null when throttled (nothing done). */
    syncedAt: string | null;
    /** Errors from upserts / the sync-state write. */
    errors: string[];
    /** Set by callers when the sync itself threw (throttle bypassed). */
    error?: string;
}

/** True for women/youth/reserve competitions — never synced to the app. */
function isEligible(fixture: ApiFootballFixture): boolean {
    const leagueName = `${fixture.league.name} ${fixture.league.country}`.toLowerCase();
    if (/women|youth|reserve/.test(leagueName)) return false;
    if (/\bu\d{2}\b/i.test(leagueName)) return false;
    return true;
}

/** detail fields the mobile app reads back (logos, country). */
function buildDetails(fixture: ApiFootballFixture): Record<string, unknown> {
    const details: Record<string, unknown> = {};
    if (fixture.league.logo) details.leagueLogo = fixture.league.logo;
    if (fixture.homeTeam.logo) details.homeTeamLogo = fixture.homeTeam.logo;
    if (fixture.awayTeam.logo) details.awayTeamLogo = fixture.awayTeam.logo;
    if (fixture.league.country) details.country = fixture.league.country;
    return details;
}

/** Diff check for manual edits: a stored value counts as a manual edit only
 * when the fresh API value exists AND differs from what is stored. */
function differs(stored: unknown, fresh: unknown): boolean {
    if (typeof fresh !== 'string' || fresh === '') return false;
    if (stored === undefined || stored === null) return false;
    return stored !== fresh;
}

/** True when the stored row was manually edited — admin changes to the team
 * names, league, kickoff, match_date or the synced details differ from the
 * fresh API values, so we never overwrite them. */
function isManualEdit(existing: DbMatch, fixture: ApiFootballFixture): boolean {
    if (differs(existing.homeTeam, fixture.homeTeam.name)) return true;
    if (differs(existing.awayTeam, fixture.awayTeam.name)) return true;
    if (differs(existing.league, fixture.league.name)) return true;
    if (differs(existing.timestamp, fixture.date)) return true;
    const freshDate = utcMatchDate(fixture.date);
    if (differs(existing.matchDate, freshDate)) return true;
    for (const [key, value] of Object.entries(buildDetails(fixture))) {
        if (differs(existing.details?.[key], value)) return true;
    }
    return false;
}

/** Last sync time for a date from the fixture_sync_log table; true when a
 * sync ran within SYNC_MIN_INTERVAL_MS. Read failures are treated as "never
 * synced" (the table may not exist yet — see supabase/fixture_sync_log.sql). */
async function recentlySynced(db: SupabaseClient, date: string): Promise<boolean> {
    const { data, error } = await db
        .from('fixture_sync_log')
        .select('last_synced_at')
        .eq('date', date)
        .limit(1);
    if (error) {
        console.warn('[SyncFixtures] fixture_sync_log read failed:', error.message);
        return false;
    }
    const row = data?.[0];
    if (!row) return false;
    const last = new Date(String(row.last_synced_at)).getTime();
    return Number.isFinite(last) && Date.now() - last < SYNC_MIN_INTERVAL_MS;
}

/** Record the sync time (best effort; failures don't fail the sync). */
async function recordSync(db: SupabaseClient, date: string, syncedAt: string): Promise<void> {
    const { error } = await db.from('fixture_sync_log').upsert({ date, last_synced_at: syncedAt });
    if (error) console.warn('[SyncFixtures] Failed to record sync time:', error.message);
}

/**
 * Sync one date's fixtures into the matches table, "fixtures first" style:
 * every non-women/youth/reserve fixture is stored as a row with
 * external_id `af-<id>`, tier 'unassigned', status 'Scheduled', kickoff,
 * league, teams, logos and country (in details) and is_history false.
 *
 * Idempotent: rows that already have a tier other than 'unassigned', an
 * ai_prediction, or manual edits are never overwritten; repeated calls are
 * no-ops (throttled to once per date per 3 hours via fixture_sync_log).
 *
 * Fetches at most one fixtures request per call (the cached API-Football
 * helper) and skips nothing that the API still returns for the date.
 */
export async function syncFixtures(db: SupabaseClient, date: string): Promise<SyncFixturesResult> {
    if (await recentlySynced(db, date)) {
        return { date, fetched: 0, inserted: 0, updated: 0, skipped: 0, syncedAt: null, errors: [] };
    }

    // 1 request: the date's fixtures (cached per date by the API helper).
    const allFixtures = await fetchFixtures(date);
    const eligible = allFixtures.filter(isEligible);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const fixture of eligible) {
        const externalId = `af-${fixture.id}`;
        const details = buildDetails(fixture);
        const existing = await getById(db, externalId);

        if (existing) {
            // Never overwrite published tiers, analysed rows (ai_prediction)
            // or manually edited rows.
            const published = existing.matchType !== undefined && existing.matchType !== 'unassigned';
            if (published || existing.aiPrediction) {
                skipped += 1;
                continue;
            }
            if (isManualEdit(existing, fixture)) {
                skipped += 1;
                continue;
            }
            const { error } = await db
                .from('matches')
                .update({
                    home_team: fixture.homeTeam.name,
                    away_team: fixture.awayTeam.name,
                    league: fixture.league.name,
                    kickoff: fixture.date,
                    match_date: utcMatchDate(fixture.date),
                    details: { ...(existing.details ?? {}), ...details },
                })
                .eq('id', existing._id);
            if (error) {
                errors.push(`update ${externalId}: ${error.message}`);
                continue;
            }
            updated += 1;
            continue;
        }

        const { error } = await db.from('matches').insert({
            external_id: externalId,
            home_team: fixture.homeTeam.name,
            away_team: fixture.awayTeam.name,
            league: fixture.league.name,
            kickoff: fixture.date,
            status: 'Scheduled',
            score: '0-0',
            match_date: utcMatchDate(fixture.date),
            tier: 'unassigned',
            trending: null,
            odds: null,
            ai_prediction: null,
            is_history: false,
            details: Object.keys(details).length > 0 ? details : null,
        });
        if (error) {
            errors.push(`insert ${externalId}: ${error.message}`);
            continue;
        }
        inserted += 1;
    }

    const syncedAt = new Date().toISOString();
    await recordSync(db, date, syncedAt);

    return { date, fetched: allFixtures.length, inserted, updated, skipped, syncedAt, errors };
}
