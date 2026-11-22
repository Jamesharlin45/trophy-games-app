/**
 * Server-only helper for the API-Football (v3) fixtures endpoint.
 *
 * Base URL: https://v3.football.api-sports.io
 * Header:   x-apisports-key (process.env.API_FOOTBALL_KEY, read server-side only)
 * Endpoint: GET /fixtures?date=YYYY-MM-DD
 *
 * Free plan limits: 100 requests/day and only yesterday/today/tomorrow dates.
 * The API reports failures inside the JSON "errors" field ([] = success)
 * rather than via HTTP status codes, so that field is always checked.
 */

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

export type ApiFootballErrorCode = 'MISSING_KEY' | 'PLAN_LIMIT' | 'API_FAILURE';

export class ApiFootballError extends Error {
    code: ApiFootballErrorCode;

    constructor(message: string, code: ApiFootballErrorCode) {
        super(message);
        this.name = 'ApiFootballError';
        this.code = code;
    }
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

interface RawApiResponse {
    response?: RawFixture[];
    errors?: unknown;
}

interface RawResultApiResponse {
    response?: RawFixtureResult[];
    errors?: unknown;
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

/** Extract human-readable messages from the API's "errors" field. */
function extractErrors(errors: unknown): string[] {
    if (Array.isArray(errors)) {
        return errors.filter((e): e is string => typeof e === 'string' && e.trim().length > 0);
    }
    if (errors !== null && typeof errors === 'object') {
        return Object.entries(errors as Record<string, unknown>)
            .map(([key, value]) => (value ? `${key}: ${String(value)}` : ''))
            .filter((message) => message.length > 0);
    }
    return [];
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

async function loadFromApi(date: string): Promise<ApiFootballFixture[]> {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) throw new ApiFootballError('API_FOOTBALL_KEY is not configured', 'MISSING_KEY');

    let res: Response;
    try {
        res = await fetch(`${BASE_URL}/fixtures?date=${date}`, {
            headers: { 'x-apisports-key': key },
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'network error';
        throw new ApiFootballError(`Failed to reach API-Football: ${reason}`, 'API_FAILURE');
    }
    if (!res.ok) throw new ApiFootballError(`API-Football returned HTTP ${res.status} for date ${date}`, 'API_FAILURE');

    let body: RawApiResponse;
    try {
        body = await res.json();
    } catch {
        throw new ApiFootballError('API-Football returned an unparseable response', 'API_FAILURE');
    }

    // Free plans report out-of-range dates as errors inside the JSON.
    const messages = extractErrors(body.errors);
    if (messages.length > 0) {
        const code: ApiFootballErrorCode = messages.some((m) => m.toLowerCase().includes('plan'))
            ? 'PLAN_LIMIT'
            : 'API_FAILURE';
        throw new ApiFootballError(messages.join('; '), code);
    }

    return Array.isArray(body.response) ? body.response.map(toFixture) : [];
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
        .then((fixtures) => {
            cache.set(date, {
                fixtures,
                expiresAt: Date.now() + (isToday(date) ? 30 * 60 * 1000 : 3 * 60 * 60 * 1000),
            });
            return fixtures;
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
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) throw new ApiFootballError('API_FOOTBALL_KEY is not configured', 'MISSING_KEY');

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
        if (!res.ok) {
            throw new ApiFootballError(`API-Football returned HTTP ${res.status} for fixtures by id`, 'API_FAILURE');
        }

        let body: RawResultApiResponse;
        try {
            body = await res.json();
        } catch {
            throw new ApiFootballError('API-Football returned an unparseable response', 'API_FAILURE');
        }

        const messages = extractErrors(body.errors);
        if (messages.length > 0) {
            const code: ApiFootballErrorCode = messages.some((m) => m.toLowerCase().includes('plan'))
                ? 'PLAN_LIMIT'
                : 'API_FAILURE';
            throw new ApiFootballError(messages.join('; '), code);
        }

        if (Array.isArray(body.response)) results.push(...body.response.map(toFixtureResult));
    }

    return results;
}
