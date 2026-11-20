/**
 * Server-only helper for the API-Football (v3) fixtures endpoint.
 *
 * Base URL: https://v3.football.api-sports.io
 * Header:   x-apisports-key (the normalised key from getApiFootballKey)
 * Endpoint: GET /fixtures?date=YYYY-MM-DD
 *
 * Free plan limits: 100 requests/day and only yesterday/today/tomorrow dates.
 * The API reports failures inside the JSON "errors" field ([] = success),
 * including on HTTP 403, so that field is always checked before the status.
 */

import {
    ApiFootballError,
    getApiFootballKey,
    type ApiFootballErrorCode,
} from './api-football-key';

export { ApiFootballError, getApiFootballKey } from './api-football-key';
export type { ApiFootballErrorCode } from './api-football-key';

const BASE_URL = 'https://v3.football.api-sports.io';

/** Fixture trimmed to the fields the admin "pick from fixtures" UI needs,
 * plus the scores settlement uses: the 90-minute score (score.fulltime) and
 * the final score (goals), both present once the fixture has started. */
export interface ApiFootballFixture {
    id: number;
    /** Kickoff time, ISO-8601 (e.g. "2026-11-19T18:00:00+00:00"). */
    date: string;
    league: { id: number; name: string; country: string; logo: string };
    homeTeam: { name: string; logo: string };
    awayTeam: { name: string; logo: string };
    status: string;
    /** 90-minute score (score.fulltime), null until the fixture has started. */
    homeScore: number | null;
    awayScore: number | null;
    /** Final score including extra time (goals), falling back to the
     * 90-minute score — same display semantics as settle.ts. */
    finalHomeScore: number | null;
    finalAwayScore: number | null;
}

/** Fixture reduced to what result settlement needs: status, the 90-minute
 * score (`score.fulltime`, used for grading) and the final score (`goals`,
 * which includes extra time but not penalties, used for display). */
export interface ApiFootballFixtureResult {
    id: number;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    finalHomeScore: number | null;
    finalAwayScore: number | null;
}

interface RawFixture {
    fixture: {
        id: number;
        date: string;
        status: { short?: string; long?: string };
        score?: { fulltime?: { home?: number | null; away?: number | null } };
        goals?: { home?: number | null; away?: number | null };
    };
    league: { id: number; name: string; country?: string; logo?: string };
    teams: {
        home: { id: number; name: string; logo?: string };
        away: { id: number; name: string; logo?: string };
    };
}

interface RawFixtureResult {
    fixture: {
        id: number;
        status: { short?: string };
    };
    goals?: { home?: number | null; away?: number | null };
    score?: {
        fulltime?: { home?: number | null; away?: number | null };
    };
}

export interface ApiFootballEnvelope<T> {
    response?: T[];
    errors?: unknown;
    results?: number;
}

interface CacheEntry {
    fixtures: ApiFootballFixture[];
    expiresAt: number;
}

// In-memory per-date cache. TTL is 30 minutes for today (live games) and 3
// hours for other days. In-flight requests are de-duplicated per date, and
// the last known data is served when a fetch fails. Resets on restart, which
// is fine: the TTL is short and well within the plan's 100 daily calls.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ApiFootballFixture[]>>();

function isToday(date: string): boolean {
    const now = new Date();
    const todayUtc = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    return date === todayUtc;
}

function messagesFromErrorValue(value: unknown): string[] {
    if (typeof value === 'string') {
        const message = value.trim();
        return message.length > 0 ? [message] : [];
    }
    if (Array.isArray(value)) {
        return value.flatMap(messagesFromErrorValue);
    }
    if (value !== null && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
            const messages = messagesFromErrorValue(entry);
            return messages.map((message) => (key.length > 0 ? `${key}: ${message}` : message));
        });
    }
    return [];
}

/** Extract human-readable messages from the API's "errors" field. */
export function extractApiFootballErrors(errors: unknown): string[] {
    return messagesFromErrorValue(errors);
}

function errorCodeForMessages(messages: string[]): ApiFootballErrorCode {
    return messages.some((message) => /(plan|limit|request|subscription|quota|rate)/i.test(message))
        ? 'PLAN_LIMIT'
        : 'API_FAILURE';
}

/**
 * Read an API-Football response. The API can return HTTP 200 or 403 with the
 * failure in the JSON "errors" field, so errors are checked before the HTTP
 * status. Messages are surfaced to the admin UI; the key is never included.
 */
export async function readApiFootballResponse<T>(
    res: Response,
    context: string,
): Promise<ApiFootballEnvelope<T>> {
    let body: ApiFootballEnvelope<T> | null = null;
    try {
        body = (await res.json()) as ApiFootballEnvelope<T>;
    } catch {
        body = null;
    }

    if (body !== null) {
        const messages = extractApiFootballErrors(body.errors);
        if (messages.length > 0) {
            throw new ApiFootballError(messages.join('; '), errorCodeForMessages(messages));
        }
    }

    if (!res.ok) {
        throw new ApiFootballError(
            `API-Football returned HTTP ${res.status} for ${context}`,
            'API_FAILURE',
        );
    }
    if (body === null) {
        throw new ApiFootballError('API-Football returned an unparseable response', 'API_FAILURE');
    }

    return body;
}

function toFixture(f: RawFixture): ApiFootballFixture {
    const home = f.fixture?.score?.fulltime?.home;
    const away = f.fixture?.score?.fulltime?.away;
    const finalHome = f.fixture?.goals?.home;
    const finalAway = f.fixture?.goals?.away;
    return {
        id: f.fixture?.id ?? 0,
        date: f.fixture?.date ?? '',
        league: { id: f.league?.id ?? 0, name: f.league?.name ?? '', country: f.league?.country ?? '', logo: f.league?.logo ?? '' },
        homeTeam: { name: f.teams?.home?.name ?? '', logo: f.teams?.home?.logo ?? '' },
        awayTeam: { name: f.teams?.away?.name ?? '', logo: f.teams?.away?.logo ?? '' },
        status: f.fixture?.status?.short ?? f.fixture?.status?.long ?? '',
        homeScore: typeof home === 'number' ? home : null,
        awayScore: typeof away === 'number' ? away : null,
        finalHomeScore: typeof finalHome === 'number' ? finalHome : (typeof home === 'number' ? home : null),
        finalAwayScore: typeof finalAway === 'number' ? finalAway : (typeof away === 'number' ? away : null),
    };
}

/** Result of one fixtures fetch for a date: the trimmed fixtures plus the
 * API's rate-limit budget for the response (when the API sent a header). */
export interface FixturesFetchResult {
    fixtures: ApiFootballFixture[];
    rateLimitRemaining: number | null;
}

function parseRateLimitRemaining(value: string | null): number | null {
    if (value === null) return null;
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

async function loadFromApi(date: string): Promise<FixturesFetchResult> {
    const key = getApiFootballKey();

    let res: Response;
    try {
        res = await fetch(`${BASE_URL}/fixtures?date=${date}`, {
            headers: { 'x-apisports-key': key },
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'network error';
        throw new ApiFootballError(`Failed to reach API-Football: ${reason}`, 'API_FAILURE');
    }

    const rateLimitRemaining = parseRateLimitRemaining(res.headers.get('x-ratelimit-requests-remaining'));

    // Free plans report out-of-range dates and plan limits as JSON errors,
    // sometimes with HTTP 403. readApiFootballResponse checks them first.
    const body = await readApiFootballResponse<RawFixture>(res, `date ${date}`);
    return {
        fixtures: Array.isArray(body.response) ? body.response.map(toFixture) : [],
        rateLimitRemaining,
    };
}

/**
 * Fetch fixtures for a date. Uses the per-date cache, de-duplicates
 * concurrent requests for the same date, and falls back to the last known
 * data if the API call fails (except for plan-limit errors, which must not
 * be masked). Throws ApiFootballError when there is no usable data.
 */
export async function fetchFixtures(date: string): Promise<ApiFootballFixture[]> {
    const entry = cache.get(date);
    if (entry && Date.now() < entry.expiresAt) return entry.fixtures;

    const pending = inflight.get(date);
    if (pending) return pending;

    const promise = loadFromApi(date)
        .then((result) => {
            cache.set(date, {
                fixtures: result.fixtures,
                expiresAt: Date.now() + (isToday(date) ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000),
            });
            return result.fixtures;
        })
        .catch((error: unknown) => {
            if (error instanceof ApiFootballError && error.code === 'PLAN_LIMIT') throw error;
            const stale = cache.get(date);
            if (stale) return stale.fixtures;
            throw error;
        })
        .finally(() => {
            inflight.delete(date);
        });

    inflight.set(date, promise);
    return promise;
}

/** Fetch fixtures for a date without the per-date cache and report the
 * API-Football rate-limit header alongside the fixtures. Used by the
 * fixture sync: it always needs fresh data and the budget of each
 * response to enforce its request floor. */
export async function fetchFixturesDetailed(date: string): Promise<FixturesFetchResult> {
    return loadFromApi(date);
}

function toFixtureResult(f: RawFixtureResult): ApiFootballFixtureResult {
    const home = f.score?.fulltime?.home;
    const away = f.score?.fulltime?.away;
    const finalHome = f.goals?.home;
    const finalAway = f.goals?.away;
    return {
        id: f.fixture?.id ?? 0,
        status: f.fixture?.status?.short ?? '',
        homeScore: typeof home === 'number' ? home : null,
        awayScore: typeof away === 'number' ? away : null,
        finalHomeScore: typeof finalHome === 'number' ? finalHome : (typeof home === 'number' ? home : null),
        finalAwayScore: typeof finalAway === 'number' ? finalAway : (typeof away === 'number' ? away : null),
    };
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/**
 * Fetch fixtures by id (`/fixtures?ids=id1-id2-...`). The API accepts at most
 * 20 ids per request, so larger lists are split into sequential batches.
 * Returns status + 90-minute score for each fixture the API knows about.
 */
export async function fetchFixtureResults(ids: number[]): Promise<ApiFootballFixtureResult[]> {
    const key = getApiFootballKey();

    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    const results: ApiFootballFixtureResult[] = [];

    for (const batch of chunk(unique, 20)) {
        let res: Response;
        try {
            res = await fetch(`${BASE_URL}/fixtures?ids=${batch.join('-')}`, {
                headers: { 'x-apisports-key': key },
            });
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'network error';
            throw new ApiFootballError(`Failed to reach API-Football: ${reason}`, 'API_FAILURE');
        }

        const body = await readApiFootballResponse<RawFixtureResult>(
            res,
            `fixtures by id (${batch.length})`,
        );
        if (Array.isArray(body.response)) results.push(...body.response.map(toFixtureResult));
    }

    return results;
}
