import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeagueInfo, MatchData } from '@trophy-games/shared';
import { createAlert } from './alerts';
import type {
    AiPrediction,
    CreateMatchInput,
    DbMatch,
    MatchOdds,
    MatchResult,
    MatchRow,
    MatchUpdateFields,
    MatchTier,
    ProxyMatchInput,
    SaveAIPredictionInput,
} from './types';

const DETAIL_STRING_KEYS = [
    'leagueLogo',
    'homeTeamLogo',
    'awayTeamLogo',
    'country',
    'countryFlag',
] as const;

/** Parse the canonical `score` column into the derived home/away score pair.
 * Convex stored homeScore/awayScore as first-class fields; Supabase stores a
 * single `score` string, so read time derives them. '' or non-numeric parts
 * mean "no score", mirroring Convex's optional fields. */
function parseScore(score: string | null | undefined): { homeScore?: number; awayScore?: number } {
    const out: { homeScore?: number; awayScore?: number } = {};
    if (typeof score !== 'string' || score === '') return out;
    const parts = score.split('-');
    if (parts.length !== 2) return out;
    const home = Number(parts[0]);
    const away = Number(parts[1]);
    if (parts[0].trim() !== '' && Number.isFinite(home)) out.homeScore = home;
    if (parts[1].trim() !== '' && Number.isFinite(away)) out.awayScore = away;
    return out;
}

/** Null/missing strings become '' — the app dereferences string fields
 * without optional chaining, so a null in the DB would crash it. */
function strOrEmpty(value: string | number | null | undefined): string {
    if (value == null) return '';
    return typeof value === 'string' ? value : String(value);
}

/** App vocabulary for results: 'pending' | 'win' | 'lose' | 'draw'. Stored
 * rows may carry other values (void is stored as result null, with the full
 * settlement in details). */
export function toAppResult(
    result: MatchResult | null | undefined,
): 'pending' | 'win' | 'lose' | 'draw' {
    if (result === 'win' || result === 'lose' || result === 'draw') return result;
    return 'pending';
}

/** True when the match settled on a technicality: settle.ts stores 'void'
 * in details.settlement.outcome with result null. The web admin still sees
 * these matches; the app endpoints (excludeVoid) hide them. */
export function isVoidOutcome(match: { details?: Record<string, unknown> | null }): boolean {
    const fromDetails = (match.details as { settlement?: { outcome?: unknown } } | null | undefined)?.settlement;
    // mapMatch spreads details onto the match itself ("mirrored at the top
    // level"), so the settlement can also live directly on the match.
    const fromSpread = (match as { settlement?: { outcome?: unknown } }).settlement;
    return fromDetails?.outcome === 'void' || fromSpread?.outcome === 'void';
}

/** Odds for the app: an object of numbers ('home', 'away', optional 'draw').
 * DB rows may carry string values, so coerce; unparseable values become 0. */
function toAppOdds(odds: MatchOdds | null | undefined): MatchOdds | undefined {
    if (!odds || typeof odds !== 'object') return undefined;
    const numberOrZero = (value: string | number | null | undefined): number => {
        const parsed = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return {
        home: numberOrZero(odds.home),
        away: numberOrZero(odds.away),
        ...(odds.draw != null ? { draw: numberOrZero(odds.draw) } : {}),
    };
}

/** aiPrediction for the app: string prediction, numeric confidence, and a
 * reasoning array of strings — missing/malformed fields are filled in. */
function toAppAiPrediction(ai: AiPrediction | null | undefined): AiPrediction | undefined {
    if (!ai || typeof ai !== 'object') return undefined;
    return {
        ...ai,
        prediction: strOrEmpty(ai.prediction),
        confidence: typeof ai.confidence === 'number' && Number.isFinite(ai.confidence) ? ai.confidence : 0,
        reasoning: Array.isArray(ai.reasoning)
            ? ai.reasoning.map((line) => (typeof line === 'string' ? line : ''))
            : [],
    };
}

/** The canonical 'H-A' score string for the app; unknown sides become ''. */
function appScore(parsed: { homeScore?: number; awayScore?: number }): string {
    return `${parsed.homeScore ?? ''}-${parsed.awayScore ?? ''}`;
}

/** Apply the app filters (void exclusion) to a mapped match list. */
function withoutVoid(matches: DbMatch[], excludeVoid?: boolean): DbMatch[] {
    return excludeVoid ? matches.filter((m) => !isVoidOutcome(m)) : matches;
}

/** Derive the match_date range-filter value (YYYY-MM-DD, UTC) from a kickoff
 * timestamp — the same format the Daily/Weekly range filter reads. */
export function utcMatchDate(timestamp: string): string {
    const t = timestamp.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    // ISO strings with an explicit offset are converted to the UTC date;
    // offset-less kickoffs are treated as UTC.
    const parsed = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(t) ? new Date(t) : new Date(`${t}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return t.split('T')[0];
}

export function mapMatch(row: MatchRow): DbMatch {
    // Rich detail fields (homeForm, potentials, h2h, ...) live in `details`
    // (no dedicated columns) and are mirrored at the top level of the
    // returned object to match Convex doc shapes.
    const details: Record<string, unknown> = { ...(row.details ?? {}) };
    const parsedScore = parseScore(row.score);
    return {
        id: row.external_id ?? row.id,
        _id: row.id,
        homeTeam: strOrEmpty(row.home_team),
        awayTeam: strOrEmpty(row.away_team),
        league: strOrEmpty(row.league),
        timestamp: strOrEmpty(row.kickoff),
        status: strOrEmpty(row.status),
        score: appScore(parsedScore),
        matchType: row.tier ?? undefined,
        isTrending: row.trending ?? undefined,
        odds: toAppOdds(row.odds),
        aiPrediction: toAppAiPrediction(row.ai_prediction),
        result: toAppResult(row.result),
        isHistory: row.is_history ?? undefined,
        matchDate: row.match_date ?? undefined,
        ...parsedScore,
        ...details,
    } as DbMatch;
}

function mapMatches(rows: MatchRow[]): DbMatch[] {
    return rows.map(mapMatch);
}

/** Typed accessor for rich detail fields mirrored onto a match by mapMatch. */
export function matchDetail<T>(m: DbMatch, key: string): T | undefined {
    const value = m[key];
    return value === undefined ? undefined : (value as T);
}

type StringEditKey = 'league' | 'homeTeam' | 'awayTeam' | 'timestamp' | 'status' | 'score';

function readOptionalString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    return String(value);
}

function readOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

/** Normalize an arbitrary JSON body into the ProxyMatchInput shape the
 * Convex proxyMatchInput validator accepted. Shared by the admin routes. */
export function sanitizeProxyMatch(m: Record<string, unknown>): ProxyMatchInput {
    const odds = m.odds as { home?: unknown; away?: unknown; draw?: unknown } | undefined;
    return {
        id: String(m.id),
        league: String(m.league ?? ''),
        leagueId: readOptionalNumber(m.leagueId),
        leagueLogo: readOptionalString(m.leagueLogo),
        homeTeam: String(m.homeTeam ?? ''),
        homeTeamId: readOptionalNumber(m.homeTeamId),
        homeTeamLogo: readOptionalString(m.homeTeamLogo),
        awayTeam: String(m.awayTeam ?? ''),
        awayTeamId: readOptionalNumber(m.awayTeamId),
        awayTeamLogo: readOptionalString(m.awayTeamLogo),
        country: readOptionalString(m.country),
        countryFlag: readOptionalString(m.countryFlag),
        timestamp: String(m.timestamp ?? new Date().toISOString()),
        status: String(m.status ?? 'Scheduled'),
        score: readOptionalString(m.score),
        homeScore: readOptionalNumber(m.homeScore),
        awayScore: readOptionalNumber(m.awayScore),
        matchType: readOptionalString(m.matchType) as MatchTier | undefined,
        isTrending: readOptionalBoolean(m.isTrending),
        odds: odds && odds.home ? {
            home: String(odds.home),
            away: String(odds.away ?? ''),
            draw: odds.draw != null ? String(odds.draw) : undefined,
        } : undefined,
    };
}

// ---------------------------------------------------------------------------
// Queries (ports of packages/backend/convex/matches.ts)
// ---------------------------------------------------------------------------

/** Extra query options used by the mobile app endpoints. */
export interface AppMatchQueryOptions {
    /** Hide AI picks that are still unpublished: rows with tier 'unassigned'
     * and an external id starting 'af-'. Every other row is unaffected. */
    excludeUnpublishedPicks?: boolean;
    /** Hide void outcomes (stored as result null + details.settlement.outcome
     * 'void'). The web admin does not set this, so void stays visible there. */
    excludeVoid?: boolean;
}

/**
 * PostgREST filter that keeps every row except unpublished AI picks
 * (tier = 'unassigned' AND external_id LIKE 'af-%'). NULL tier / external id
 * rows are kept, and so is every other tier.
 */
const EXCLUDE_UNPUBLISHED_PICKS_FILTER =
    'tier.is.null,tier.neq.unassigned,external_id.is.null,not.and(tier.eq.unassigned,external_id.like.af-*)';

function isUnpublishedPick(row: MatchRow): boolean {
    return row.tier === 'unassigned' && typeof row.external_id === 'string' && row.external_id.startsWith('af-');
}

/** api.matches.getAll — newest first, capped at `limit`. */
export async function getAll(
    db: SupabaseClient,
    limit = 100,
    options?: AppMatchQueryOptions,
): Promise<DbMatch[]> {
    const base = db.from('matches').select('*');
    const query = options?.excludeUnpublishedPicks
        ? base.or(EXCLUDE_UNPUBLISHED_PICKS_FILTER)
        : base;
    const { data } = await query
        .order('kickoff', { ascending: false })
        .limit(limit);
    return withoutVoid(mapMatches((data ?? []) as MatchRow[]), options?.excludeVoid);
}

/** api.matches.getById — external id first, then the row id as fallback
 * (mirrors the Convex by_match_id index + ctx.db.get fallback). */
export async function getById(
    db: SupabaseClient,
    matchId: string,
    options?: AppMatchQueryOptions,
): Promise<DbMatch | null> {
    const { data } = await db.from('matches').select('*').eq('external_id', matchId).limit(1);
    if (data && data.length > 0) {
        const row = data[0] as MatchRow;
        if (options?.excludeUnpublishedPicks && isUnpublishedPick(row)) return null;
        const mapped = mapMatch(row);
        return options?.excludeVoid && isVoidOutcome(mapped) ? null : mapped;
    }
    const byRowId = await db.from('matches').select('*').eq('id', matchId).limit(1);
    if (byRowId.data && byRowId.data.length > 0) {
        const row = byRowId.data[0] as MatchRow;
        if (options?.excludeUnpublishedPicks && isUnpublishedPick(row)) return null;
        const mapped = mapMatch(row);
        return options?.excludeVoid && isVoidOutcome(mapped) ? null : mapped;
    }
    return null;
}

/** api.matches.getByDate — matches on a date, newest first, capped at 100. */
export async function getByDate(
    db: SupabaseClient,
    date: string,
    options?: AppMatchQueryOptions,
): Promise<DbMatch[]> {
    const base = db.from('matches').select('*').eq('match_date', date);
    const query = options?.excludeUnpublishedPicks
        ? base.or(EXCLUDE_UNPUBLISHED_PICKS_FILTER)
        : base;
    const { data } = await query
        .order('kickoff', { ascending: false })
        .limit(100);
    return withoutVoid(mapMatches((data ?? []) as MatchRow[]), options?.excludeVoid);
}

/** api.matches.getByTypeAndDate — matches of one tier on a date, newest
 * first (mobile list screens). */
export async function getByTypeAndDate(
    db: SupabaseClient,
    matchType: MatchTier,
    date: string,
    limit = 100,
    options?: AppMatchQueryOptions,
): Promise<DbMatch[]> {
    const base = db.from('matches').select('*').eq('tier', matchType).eq('match_date', date);
    const query = options?.excludeUnpublishedPicks
        ? base.or(EXCLUDE_UNPUBLISHED_PICKS_FILTER)
        : base;
    const { data } = await query
        .order('kickoff', { ascending: false })
        .limit(limit);
    return withoutVoid(mapMatches((data ?? []) as MatchRow[]), options?.excludeVoid);
}

/** Admin-only: stored unpublished fixtures for a date — rows with an
 * external id starting 'af-' and tier 'unassigned', i.e. exactly the set the
 * mobile endpoints exclude (see excludeUnpublishedPicks). Newest first. */
export async function getUnpublishedFixtures(db: SupabaseClient, date: string): Promise<DbMatch[]> {
    const { data } = await db
        .from('matches')
        .select('*')
        .eq('match_date', date)
        .eq('tier', 'unassigned')
        .like('external_id', 'af-%')
        .order('kickoff', { ascending: false })
        .limit(100);
    return mapMatches((data ?? []) as MatchRow[]);
}

/** api.matches.getHistory — the mobile Wins feed: status Finished/FT or
 * flagged history, newest first. */
export async function getHistory(
    db: SupabaseClient,
    limit = 100,
    options?: AppMatchQueryOptions,
): Promise<DbMatch[]> {
    const { data } = await db
        .from('matches')
        .select('*')
        .or('status.eq.Finished,status.eq.FT,is_history.eq.true')
        .order('kickoff', { ascending: false })
        .limit(limit);
    return withoutVoid(mapMatches((data ?? []) as MatchRow[]), options?.excludeVoid);
}

/** Mobile history feed: finished matches that carry a published tip — tier
 * free/vip/paid with an ai_prediction; unpublished picks (tier
 * 'unassigned' or null) are excluded. Newest first. */
export async function getPublishedFinishedMatches(
    db: SupabaseClient,
    options?: AppMatchQueryOptions,
): Promise<DbMatch[]> {
    const { data } = await db
        .from('matches')
        .select('*')
        .or('status.eq.Finished,status.eq.FT,is_history.eq.true')
        .order('match_date', { ascending: false })
        .limit(1000);
    return withoutVoid(
        mapMatches((data ?? []) as MatchRow[]).filter(
            (m) => (m.matchType === 'free' || m.matchType === 'vip' || m.matchType === 'paid') && Boolean(m.aiPrediction),
        ),
        options?.excludeVoid,
    );
}

// ---------------------------------------------------------------------------
// Mutations (ports of Convex mutations)
// ---------------------------------------------------------------------------

/** api.matches.update — admin edit. Partial edits never erase untouched
 * fields; an empty string clears an optional text field; `null` scores
 * clear them. `aiPrediction` only applied when the key is present. */
export async function updateMatch(db: SupabaseClient, matchId: string, edits: MatchUpdateFields): Promise<void> {
    const existing = await getById(db, matchId);
    if (!existing) throw new Error(`Match with id ${matchId} not found`);

    const dbUpdates: Record<string, unknown> = {};
    const details: Record<string, unknown> = { ...(existing.details ?? {}) };

    // String fields → columns; '' clears the column (Convex removes the key).
    const stringCols: Array<[StringEditKey, string]> = [
        ['league', 'league'],
        ['homeTeam', 'home_team'],
        ['awayTeam', 'away_team'],
        ['timestamp', 'kickoff'],
        ['status', 'status'],
        ['score', 'score'],
    ];
    for (const [key, col] of stringCols) {
        const value = edits[key];
        if (value === undefined) continue;
        const trimmed = value.trim();
        dbUpdates[col] = trimmed === '' ? null : trimmed;
    }
    if (edits.matchDate !== undefined) {
        const trimmed = edits.matchDate.trim();
        dbUpdates.match_date = trimmed === '' ? null : trimmed;
    }

    // Logo / country fields have no columns — they live in `details`.
    for (const key of DETAIL_STRING_KEYS) {
        const value = edits[key];
        if (value === undefined) continue;
        const trimmed = value.trim();
        if (trimmed === '') delete details[key];
        else details[key] = trimmed;
    }

    // Scores: the Supabase schema stores the canonical `score` string;
    // homeScore/awayScore are derived at read time (no separate columns).
    if (edits.homeScore !== undefined || edits.awayScore !== undefined) {
        const old = parseScore(existing.score);
        if (edits.homeScore === null && edits.awayScore === null) {
            dbUpdates.score = '';
        } else {
            const oldH = old.homeScore ?? '';
            const oldA = old.awayScore ?? '';
            const newH = edits.homeScore === null ? '' : (edits.homeScore ?? oldH);
            const newA = edits.awayScore === null ? '' : (edits.awayScore ?? oldA);
            dbUpdates.score = `${newH}-${newA}`;
        }
    }

    if (edits.matchType !== undefined) dbUpdates.tier = edits.matchType;
    if (edits.isTrending !== undefined) dbUpdates.trending = edits.isTrending;
    if (edits.isHistory !== undefined) dbUpdates.is_history = edits.isHistory;

    if (edits.odds !== undefined) {
        if (edits.odds === null) {
            dbUpdates.odds = null;
        } else {
            const home = edits.odds.home.trim();
            const away = edits.odds.away.trim();
            const draw = edits.odds.draw?.trim() || undefined;
            dbUpdates.odds = home || away || draw ? { home, away, ...(draw ? { draw } : {}) } : null;
        }
    }

    if (edits.aiPrediction !== undefined) {
        const ai = edits.aiPrediction;
        dbUpdates.ai_prediction = {
            prediction: ai.prediction.trim(),
            confidence: ai.confidence,
            reasoning: ai.reasoning.map((line: string) => line.trim()).filter((line: string) => line.length > 0),
            generatedAt: ai.generatedAt || new Date().toISOString(),
            ...(ai.suggestedBet ? { suggestedBet: ai.suggestedBet.trim() } : {}),
        };
    }

    // Keep the derived date in sync with an edited kickoff.
    if (edits.timestamp && edits.timestamp.trim() !== '') {
        dbUpdates.match_date = edits.timestamp.trim().split('T')[0];
    }

    // Auto-history rule shared with the History page and the mobile Wins
    // tab: a decisive result puts the match in the history feed (on its
    // match date); reverting to pending takes it back out.
    if (edits.result !== undefined) {
        dbUpdates.result = edits.result;
        if (edits.result === 'win' || edits.result === 'lose' || edits.result === 'draw') {
            dbUpdates.is_history = true;
            if (!existing.matchDate) {
                const dateSource =
                    (edits.timestamp && edits.timestamp.trim()) || existing.timestamp || new Date().toISOString();
                dbUpdates.match_date = dateSource.split('T')[0];
            }
        } else {
            dbUpdates.is_history = false;
        }
    }

    dbUpdates.details = details;
    const { error } = await db.from('matches').update(dbUpdates).eq('id', existing._id);
    if (error) throw new Error(error.message);
}

/** api.matches.create — insert a new match (manual matches carry their
 * `manual-*` external id via `external_id`). Returns the external id. */
export async function createMatch(db: SupabaseClient, match: CreateMatchInput): Promise<string> {
    const matchDate = match.timestamp ? utcMatchDate(match.timestamp) : new Date().toISOString().slice(0, 10);
    const score =
        match.score ||
        (match.homeScore != null && match.awayScore != null
            ? `${match.homeScore}-${match.awayScore}`
            : '0-0');
    const details: Record<string, unknown> = {};
    for (const key of DETAIL_STRING_KEYS) {
        if (match[key] !== undefined) details[key] = match[key];
    }
    const { error } = await db
        .from('matches')
        .insert({
            external_id: match.id,
            home_team: match.homeTeam,
            away_team: match.awayTeam,
            league: match.league,
            kickoff: match.timestamp,
            status: match.status,
            score,
            match_date: matchDate,
            tier: match.matchType ?? null,
            trending: match.isTrending ?? null,
            odds: match.odds ?? null,
            ai_prediction: match.aiPrediction ?? null,
            is_history: false,
            details: Object.keys(details).length > 0 ? details : null,
        })
        .select('id');
    if (error) throw new Error(error.message);

    // Port of Convex matches.create: inserting a match with a tip tier also
    // fires the corresponding "New ... Tip" alert and pushes to every
    // registered device. Convex scheduled these via the scheduler and
    // logged failures without failing the caller — same behavior here.
    try {
        await fireCreateAlerts(db, match);
    } catch (alertError) {
        console.error('[createMatch] Failed to fire alerts for new match:', alertError);
    }

    return match.id;
}

/** Alerts fired by Convex matches.create when a match is created with a
 * tip tier ('unassigned' fires nothing). */
async function fireCreateAlerts(db: SupabaseClient, match: CreateMatchInput): Promise<void> {
    switch (match.matchType) {
        case 'free':
            await createAlert(db, {
                title: 'New Free Tip Added!',
                body: `Check out the new match: ${match.homeTeam} vs ${match.awayTeam}`,
            });
            break;
        case 'vip':
            await createAlert(db, {
                title: '🔥 New VIP Tip Available',
                body: 'Exclusive VIP prediction just dropped! Unlock premium access to win big today.',
            });
            break;
        case 'paid':
            await createAlert(db, {
                title: '💰 New Paid Tip Available',
                body: 'High-confidence paid prediction added! Get access now for expert insights.',
            });
            break;
    }
}

/** api.matches.deleteMatch. */
export async function deleteMatch(db: SupabaseClient, matchId: string): Promise<{ success: true }> {
    const existing = await getById(db, matchId);
    if (!existing) throw new Error(`Match with id ${matchId} not found`);
    await db.from('matches').delete().eq('id', existing._id);
    return { success: true };
}

/** api.matches.updateMatchType — tag a match free/paid/vip (and upsert the
 * proxy match when it isn't stored yet). Returns void; callers re-read. */
export async function updateMatchType(
    db: SupabaseClient,
    matchId: string,
    matchType: MatchTier,
    match?: ProxyMatchInput,
): Promise<void> {
    let existing = await getById(db, matchId);
    if (!existing && match) {
        existing = await insertProxyMatch(db, { ...match, matchType: 'unassigned' });
    }
    if (existing) {
        // Pre-change type. Convex compared the new type against the
        // pre-patch document value before firing alerts.
        const previousTier = existing.matchType;
        await db.from('matches').update({ tier: matchType }).eq('id', existing._id);

        // Port of Convex matches.updateMatchType: when the type changes to
        // a tip tier, the corresponding "New ... Prediction" alert is fired
        // and pushed to every registered device ('unassigned' fires nothing).
        if (matchType !== previousTier) {
            try {
                await fireMatchTypeChangeAlerts(db, matchType, existing);
            } catch (alertError) {
                console.error('[updateMatchType] Failed to fire alerts for tier change:', alertError);
            }
        }
    }
}

/** Alerts fired by Convex matches.updateMatchType when the tier changes
 * ('unassigned' fires nothing). */
async function fireMatchTypeChangeAlerts(
    db: SupabaseClient,
    matchType: MatchTier,
    existing: DbMatch,
): Promise<void> {
    switch (matchType) {
        case 'free':
            await createAlert(db, {
                title: 'Free Tip Added!',
                body: `A new high-confidence free tip has been added: ${existing.homeTeam} vs ${existing.awayTeam}. Check it out now!`,
            });
            break;
        case 'vip':
            await createAlert(db, {
                title: '🔥 New VIP Prediction',
                body: 'Exclusive VIP tip now available! Upgrade to premium for expert predictions.',
            });
            break;
        case 'paid':
            await createAlert(db, {
                title: '💰 New Paid Prediction',
                body: 'Premium paid tip just added! Unlock access for professional insights.',
            });
            break;
    }
}

/** api.matches.saveAIPrediction — stamp + store the prediction (upserting a
 * proxy match first when needed). */
export async function saveAIPrediction(
    db: SupabaseClient,
    matchId: string,
    aiPrediction: SaveAIPredictionInput,
    match?: ProxyMatchInput,
): Promise<void> {
    let existing = await getById(db, matchId);
    if (!existing && match) existing = await insertProxyMatch(db, match);
    if (existing) {
        await db.from('matches').update({
            ai_prediction: { ...aiPrediction, generatedAt: new Date().toISOString() },
        }).eq('id', existing._id);
    }
}

/** api.matches.enrichMatch — write rich per-match detail fields back so the
 * web admin can display them. Null/undefined values are skipped (partial
 * update); a missing match is an error, as in Convex. */
export async function enrichMatch(db: SupabaseClient, matchId: string, data: Record<string, unknown>): Promise<{ success: true }> {
    const existing = await getById(db, matchId);
    if (!existing) throw new Error(`Match ${matchId} not found`);
    const details: Record<string, unknown> = { ...(existing.details ?? {}) };
    for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) details[key] = value;
    }
    await db.from('matches').update({ details }).eq('id', existing._id);
    return { success: true };
}

/** api.matches.saveAll — bulk sync from the FootyStats proxy, preserving
 * admin overlay fields (matchType, aiPrediction, result, isHistory,
 * isTrending) when the new data lacks them. */
export async function saveAll(db: SupabaseClient, matches: MatchData[], leagues: LeagueInfo[] = []): Promise<void> {
    const now = new Date().toISOString();
    for (const m of matches) {
        const matchDate = m.matchDate || (m.timestamp ? utcMatchDate(m.timestamp) : now.slice(0, 10));
        const existing = await getById(db, m.id);
        const updates: Record<string, unknown> = {
            home_team: m.homeTeam,
            away_team: m.awayTeam,
            league: m.league,
            kickoff: m.timestamp,
            score: m.score || '0-0',
            match_date: matchDate,
        };
        if (m.matchType !== undefined) updates.tier = m.matchType;
        else updates.tier = existing?.matchType ?? null;
        if (m.aiPrediction) updates.ai_prediction = m.aiPrediction;
        else updates.ai_prediction = existing?.aiPrediction ?? null;
        if (m.result) updates.result = m.result;
        else updates.result = existing?.result ?? null;
        if (m.isHistory) updates.is_history = m.isHistory;
        else updates.is_history = existing?.isHistory ?? null;
        if (m.isTrending !== undefined) updates.trending = m.isTrending;
        else updates.trending = existing?.isTrending ?? null;
        if (m.odds) updates.odds = m.odds;
        else updates.odds = existing?.odds ?? null;
        const detailUpdates: Record<string, unknown> = {};
        for (const key of DETAIL_STRING_KEYS) {
            if (m[key] !== undefined) detailUpdates[key] = m[key];
        }
        if (Object.keys(detailUpdates).length > 0) {
            updates.details = { ...(existing?.details ?? {}), ...detailUpdates };
        }

        if (existing) {
            await db.from('matches').update(updates).eq('id', existing._id);
        } else {
            await db.from('matches').insert({
                external_id: m.id,
                is_history: false,
                ...updates,
            }).select('id');
        }
    }

    for (const league of leagues) {
        const { data } = await db
            .from('leagues')
            .select('id')
            .eq('old_id', league.id)
            .limit(1);
        const row = {
            convex_id: String(league.id),
            old_id: league.id,
            name: league.name,
            url: league.url ?? null,
            logo: league.logo ?? null,
            type: league.type ?? null,
            match_count: league.matchCount ?? null,
            country: league.country ?? null,
            country_id: league.countryId ?? null,
            country_flag: league.countryFlag ?? null,
        };
        if (data && data.length > 0) {
            await db.from('leagues').update(row).eq('id', data[0].id);
        } else {
            await db.from('leagues').insert(row).select('id');
        }
    }
}

/** api.matches.setTrending — toggleTrending; not used by the web app but
 * part of the ported match API surface. */
export async function setTrending(db: SupabaseClient, matchId: string): Promise<void> {
    const existing = await getById(db, matchId);
    if (!existing) return;
    await db.from('matches').update({ trending: !(existing.trending ?? false) }).eq('id', existing._id);
}

/** Port of Convex insertProxyMatch: insert a proxy match (before tagging it)
 * with the given type, without firing any alerts. */
async function insertProxyMatch(db: SupabaseClient, match: ProxyMatchInput, forcedType?: MatchTier): Promise<DbMatch> {
    const matchDate = match.timestamp ? utcMatchDate(match.timestamp) : new Date().toISOString().slice(0, 10);
    const score =
        match.score ||
        (match.homeScore != null && match.awayScore != null
            ? `${match.homeScore}-${match.awayScore}`
            : '0-0');
    const details: Record<string, unknown> = {};
    for (const key of DETAIL_STRING_KEYS) {
        if (match[key] !== undefined) details[key] = match[key];
    }
    const { data } = await db
        .from('matches')
        .insert({
            external_id: match.id,
            home_team: match.homeTeam,
            away_team: match.awayTeam,
            league: match.league,
            kickoff: match.timestamp,
            status: match.status,
            score,
            match_date: matchDate,
            tier: forcedType ?? match.matchType ?? null,
            trending: match.isTrending ?? null,
            odds: match.odds ?? null,
            is_history: false,
            details: Object.keys(details).length > 0 ? details : null,
        })
        .select('*')
        .single();
    if (!data) throw new Error(`Failed to upsert match ${match.id}`);
    return mapMatch(data as MatchRow);
}
