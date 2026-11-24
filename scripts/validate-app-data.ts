/**
 * Live validator for the mobile app's match endpoints (A).
 *
 * Fetches the live /api/app/matches/* endpoints and reports every match that
 * violates what the app expects from them:
 *   - result is always pending | win | lose | draw
 *   - aiPrediction.reasoning is a string array
 *   - aiPrediction.confidence is a number
 *   - aiPrediction.prediction is a string
 *   - score is a 'H-A' string
 *   - odds is an object of numbers
 *   - null strings become '' (core string fields are non-null)
 *
 * Usage: bun scripts/validate-app-data.ts [baseUrl]
 *   baseUrl defaults to https://trophy-games-app.vercel.app
 */

const BASE = (process.argv[2] ?? 'https://trophy-games-app.vercel.app').replace(/\/+$/, '');
const TIERS = ['free', 'paid', 'vip', 'unassigned'] as const;

interface Violation {
    endpoint: string;
    matchId: string;
    message: string;
}

interface MatchLike {
    id?: unknown;
    result?: unknown;
    score?: unknown;
    odds?: unknown;
    league?: unknown;
    homeTeam?: unknown;
    awayTeam?: unknown;
    timestamp?: unknown;
    status?: unknown;
    details?: { settlement?: { outcome?: unknown } } | null;
    aiPrediction?: {
        prediction?: unknown;
        confidence?: unknown;
        reasoning?: unknown;
    } | null;
    [key: string]: unknown;
}

const APP_RESULTS = ['pending', 'win', 'lose', 'draw'];
const SCORE_RE = /^\d*-\d*$/;
const NULL_STRING_FIELDS = ['id', 'league', 'homeTeam', 'awayTeam', 'timestamp', 'status', 'score'];

function describe(value: unknown): string {
    return JSON.stringify(value) ?? String(value);
}

async function getJson(path: string): Promise<unknown> {
    const response = await fetch(`${BASE}${path}`);
    if (!response.ok) throw new Error(`GET ${path} -> HTTP ${response.status}`);
    return response.json();
}

function matchId(match: MatchLike): string {
    return typeof match.id === 'string' && match.id.length > 0 ? match.id : '<unknown>';
}

function validateMatch(endpoint: string, match: MatchLike, violations: Violation[]): void {
    const id = matchId(match);
    const push = (message: string) => violations.push({ endpoint, matchId: id, message });

    // result: always one of the app vocabulary.
    if (!('result' in match) || match.result == null) {
        push(`result is missing or null (expected one of: ${APP_RESULTS.join(', ')})`);
    } else if (!APP_RESULTS.includes(match.result as (typeof APP_RESULTS)[number])) {
        push(`result must be one of ${APP_RESULTS.join(', ')} (got ${describe(match.result)})`);
    }

    // Void outcomes are excluded from app endpoints.
    if (match.result == null && match.details?.settlement?.outcome === 'void') {
        push("void outcome present (result null + details.settlement.outcome='void')");
    }

    // aiPrediction: reasoning array of strings, numeric confidence, string prediction.
    const ai = match.aiPrediction;
    if (ai) {
        if (!Array.isArray(ai.reasoning)) {
            push(`aiPrediction.reasoning must be a string array (got ${describe(ai.reasoning)})`);
        } else {
            const bad = ai.reasoning.filter((r) => typeof r !== 'string');
            if (bad.length > 0) push(`aiPrediction.reasoning has ${bad.length} non-string element(s)`);
        }
        if (typeof ai.confidence !== 'number') {
            push(`aiPrediction.confidence must be a number (got ${describe(ai.confidence)})`);
        }
        if (typeof ai.prediction !== 'string') {
            push(`aiPrediction.prediction must be a string (got ${describe(ai.prediction)})`);
        }
    }

    // score: always the canonical 'H-A' string.
    if (typeof match.score !== 'string' || !SCORE_RE.test(match.score)) {
        push(`score must be a 'H-A' string (got ${describe(match.score)})`);
    }

    // odds: an object of numbers.
    if (match.odds != null) {
        if (typeof match.odds !== 'object') {
            push(`odds must be an object of numbers (got ${describe(match.odds)})`);
        } else {
            const odds = match.odds as Record<string, unknown>;
            for (const key of ['home', 'away', 'draw']) {
                const value = odds[key];
                if (value != null && typeof value !== 'number') {
                    push(`odds.${key} must be a number (got ${describe(value)})`);
                }
            }
        }
    }

    // Null strings become '' — core string fields must not be null.
    for (const field of NULL_STRING_FIELDS) {
        if (match[field] === null) {
            push(`${field} is null (expected '')`);
        }
    }
}

function validateMatches(endpoint: string, matches: MatchLike[], violations: Violation[]): void {
    console.log(`[GET ${endpoint}] ${matches.length} match(es)`);
    for (const match of matches) validateMatch(endpoint, match, violations);
}

/** Dates to probe by-type-and-date with: the last six UTC days, newest first. */
function recentDates(): string[] {
    const dates: string[] = [];
    for (let i = 0; i < 6; i += 1) {
        const d = new Date(Date.now() - i * 86_400_000);
        dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
}

async function main(): Promise<void> {
    const violations: Violation[] = [];

    const history = await getJson('/api/app/matches/history');
    const historyMatches = Array.isArray(history)
        ? history
        : Array.isArray((history as { matches?: MatchLike[] })?.matches)
          ? (history as { matches: MatchLike[] }).matches
          : [];
    validateMatches('/api/app/matches/history', historyMatches as MatchLike[], violations);

    const all = await getJson('/api/app/matches/all');
    validateMatches('/api/app/matches/all', (all as MatchLike[] | null) ?? [], violations);

    for (const tier of TIERS) {
        for (const date of recentDates()) {
            const endpoint = `/api/app/matches/by-type-and-date?matchType=${tier}&date=${date}`;
            const matches = await getJson(endpoint);
            validateMatches(endpoint, (matches as MatchLike[] | null) ?? [], violations);
        }
    }

    console.log('');
    if (violations.length === 0) {
        console.log('No violations found — app expectations are met.');
        return;
    }
    console.log(`Violations: ${violations.length}`);
    for (const v of violations) console.log(`  ${v.endpoint} ${v.matchId}: ${v.message}`);
    process.exit(1);
}

main().catch((error) => {
    console.error('validate-app-data failed:', error instanceof Error ? error.message : error);
    process.exit(2);
});
