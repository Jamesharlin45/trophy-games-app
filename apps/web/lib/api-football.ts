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

/** Fixture trimmed to the fields the admin "pick from fixtures" UI needs. */
export interface ApiFootballFixture {
    id: number;
    /** Kickoff time, ISO-8601 (e.g. "2026-11-19T18:00:00+00:00"). */
    date: string;
    league: { id: number; name: string; country: string; logo: string };
    homeTeam: { name: string; logo: string };
    awayTeam: { name: string; logo: string };
    status: string;
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
    };
    league: { id: number; name: string; country?: string; logo?: string };
    teams: {
        home: { id: number; name: string; logo?: string };
        away: { id: number; name: string; logo?: string };
    };
}

interface RawApiResponse {
    response?: RawFixture[];
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
    return {
        id: f.fixture?.id ?? 0,
        date: f.fixture?.date ?? '',
        league: { id: f.league?.id ?? 0, name: f.league?.name ?? '', country: f.league?.country ?? '', logo: f.league?.logo ?? '' },
        homeTeam: { name: f.teams?.home?.name ?? '', logo: f.teams?.home?.logo ?? '' },
        awayTeam: { name: f.teams?.away?.name ?? '', logo: f.teams?.away?.logo ?? '' },
        status: f.fixture?.status?.short ?? f.fixture?.status?.long ?? '',
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
