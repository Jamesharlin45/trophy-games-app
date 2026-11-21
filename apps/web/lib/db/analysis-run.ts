// Reworked "Run Analysis": analyse stored Supabase matches for the selected
// date (daily) or week (weekly) with DeepSeek web search.
//
// - No football APIs are called in this flow.
// - Tier split constants are at the top of this file.
// - Input: only matches with tier 'unassigned', no result and a Scheduled
//   status; matches that have already started are never picked.
// - The run endpoint processes at most CHUNK_SIZE matches per request and
//   saves each proposal as it completes; the admin page calls it repeatedly
//   and shows progress ("Analysing X/Y").
// - While the run is in progress every proposal is stored in
//   analysis_results.proposals — never in matches.ai_prediction.
// - Only the Approve step (api/analysis/approve) writes ai_prediction, tier
//   and reasoning to matches, and only on untagged, unresulted matches.
// - Tiers are assigned deterministically by rankPicksInCode: confidence desc,
//   ties lower risk then higher odds; Free = top FREE_COUNT, VIP = next
//   VIP_COUNT, Paid = next PAID_COUNT; picks below MIN_TIP_CONFIDENCE get no
//   tier. No separate ranking call is made.

import type { SupabaseClient } from '@supabase/supabase-js';
import { TRENDING_LEAGUES, TRENDING_LEAGUE_IDS } from '@trophy-games/shared';
import { mapAnalysisResult, type AnalysisResult, type AnalysisResultRow, type Recommendation, type StoredProposal } from './analysis';
import type { MatchRow } from './types';

// --- Tier split constants (top of this file) ---
export const FREE_COUNT = 3;
export const VIP_COUNT = 3;
export const PAID_COUNT = 4;
export const MIN_TIP_CONFIDENCE = 55;

// Max matches analysed per run — the page's default "Matches to analyse".
export const MAX_MATCHES = 10;
// Hard cap for the user-supplied "Matches to analyse" page value (1..30).
export const MAX_MATCHES_LIMIT = 30;

const CHUNK_SIZE = 3; // max matches analysed per run-endpoint request — one parallel wave under the 60s limit
const PARALLEL_WORKERS = 3; // 3 workers => each request is a wave of CHUNK_SIZE
const DEEPSEEK_FLASH_MODEL = 'deepseek-flash';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const ANALYST_MAX_TOKENS = 3000;
const VERIFIER_MAX_TOKENS = 1500;
const CALL_TIMEOUT_MS = 45000;
const MAX_SOURCES_PER_PICK = 3;

export type Tier = 'free' | 'vip' | 'paid';
export interface TierSplit {
    free: string[];
    vip: string[];
    paid: string[];
}

export interface PerMatchResult {
    matchId: string;
    pick: string;
    confidence: number;
    risk: 'low' | 'medium' | 'high';
    suggestedBet: string;
    reasoning: string[];
    sources: string[];
    homeTeam: string;
    awayTeam: string;
    league: string;
    timestamp: string;
    oddsScore: number;
}

export interface RunChunkResult {
    state: 'running' | 'complete';
    total: number;
    analysed: number;
    errors: string[];
    /** Candidates excluded because they had already started. */
    excludedStarted: number;
    /** Candidates skipped because they already had stored proposals (no rerun). */
    skipped: number;
    /** DeepSeek API calls made during this request. */
    deepseekCalls: number;
    complete?: { ranked: TierSplit; analysed: number };
}

class DeepSeekApiError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'DeepSeekApiError';
    }
}

// --- DeepSeek chat completions (Chat Completions API, deepseek-flash) ---

interface DeepSeekMessage {
    content?: string | null;
    annotations?: Array<{ url_citation?: { url?: string } }>;
    server_tool_calls?: Array<{ calls?: Array<{ type?: string; sources?: Array<{ url?: string }> }> }>;
}

interface DeepSeekHttpResponse {
    choices?: Array<{ message?: DeepSeekMessage }>;
}

interface DeepSeekCallResult {
    content: string;
    sources: string[];
}

const SYSTEM_PROMPT_ANALYST = `You are an elite football betting analyst with 15+ years of experience.

For the match, provide:
1. pick: the recommended bet outcome, e.g. "Home Win", "Away Win", "Draw", "Both Teams To Score", "Over 2.5 Goals" or "Under 2.5 Goals"
2. confidence: 1-100
3. risk: "low", "medium" or "high"
4. suggestedBet: the specific bet, e.g. "Home Win" or "Over 2.5 Goals"
5. reasoning: 2-4 short analytical points as an array of strings
6. sources: up to 3 URLs from the web search citations

Rules:
- Use the web search tool to find current team form (last 5-10 matches), injuries, suspensions, lineup news and match context.
- If you cannot find reliable information, lower the confidence and say so in the reasoning.
- Do not invent data.
- Return ONLY valid JSON:
{
  "pick": "Home Win",
  "confidence": 78,
  "risk": "medium",
  "suggestedBet": "Home Win",
  "reasoning": ["...", "..."],
  "sources": ["https://example.com/1", "https://example.com/2"]
}`;

const SYSTEM_PROMPT_VERIFIER = `You are a senior betting verification analyst. Double-check the analyst's pick for the match.

Verify the confidence, risk and suggestedBet. Adjust the confidence down when evidence is weak, and say so in the reasoning.

Return ONLY valid JSON with the same shape as the analyst output:
{
  "pick": "...",
  "confidence": 78,
  "risk": "medium",
  "suggestedBet": "...",
  "reasoning": ["...", "..."],
  "sources": ["https://example.com/1", "https://example.com/2"]
}`;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepSeekErrorStatus(status: number): number {
    if (status === 401 || status === 402 || status === 408 || status === 429) return status;
    if (status >= 500) return status >= 504 ? 504 : 500;
    return 500;
}

function isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

function collectSources(message: DeepSeekMessage): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (url: string | undefined): void => {
        const trimmed = url?.trim();
        if (trimmed && isHttpUrl(trimmed) && !seen.has(trimmed)) {
            seen.add(trimmed);
            out.push(trimmed);
        }
    };
    for (const step of message.server_tool_calls ?? []) {
        for (const call of step.calls ?? []) {
            if (call.type !== 'deepseek_web_search') continue;
            for (const src of call.sources ?? []) push(src.url);
        }
    }
    for (const ann of message.annotations ?? []) push(ann.url_citation?.url);
    return out.slice(0, MAX_SOURCES_PER_PICK);
}

async function doCallDeepSeek(
    system: string,
    user: string,
    apiKey: string,
    opts: { search: boolean; maxTokens?: number },
): Promise<DeepSeekCallResult> {
    const body: Record<string, unknown> = {
        model: DEEPSEEK_FLASH_MODEL,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
        max_tokens: opts.maxTokens ?? 4096,
        temperature: 0.3,
    };
    if (opts.search) {
        // Per the DeepSeek web tools docs (Chat Completions): declare the tool only.
        body.tools = [{ type: 'deepseek_web_search' }];
    }

    let res: Response;
    try {
        res = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
    } catch {
        throw new DeepSeekApiError(504, 'DeepSeek request timed out');
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new DeepSeekApiError(
            deepSeekErrorStatus(res.status),
            `DeepSeek API error (${res.status}): ${text.slice(0, 200)}`,
        );
    }

    const data = (await res.json().catch(() => null)) as DeepSeekHttpResponse | null;
    const message = data?.choices?.[0]?.message;
    if (!message) {
        throw new DeepSeekApiError(500, 'DeepSeek returned an invalid response');
    }
    const content = message.content ?? '';
    return { content, sources: collectSources(message) };
}

async function callDeepSeek(
    system: string,
    user: string,
    apiKey: string,
    opts: { search: boolean; maxTokens?: number },
): Promise<DeepSeekCallResult> {
    let lastError: DeepSeekApiError | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await doCallDeepSeek(system, user, apiKey, opts);
        } catch (err) {
            if (!(err instanceof DeepSeekApiError) || !isRetryableStatus(err.status) || attempt === 2) throw err;
            lastError = err;
            await sleep(250 * (attempt + 1));
        }
    }
    throw lastError ?? new DeepSeekApiError(500, 'DeepSeek request failed');
}

// --- Robust JSON extraction from model output ---

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strip markdown code fences and take the first parseable JSON object. */
function extractJsonObject(text: string): Record<string, unknown> | null {
    const start = text.indexOf('{');
    if (start === -1) return null;
    for (let i = text.length - 1; i >= start; i--) {
        if (text[i] !== '}') continue;
        try {
            const parsed: unknown = JSON.parse(text.slice(start, i + 1));
            if (isRecord(parsed)) return parsed;
        } catch {
            // keep scanning backwards for a valid object
        }
    }
    return null;
}

function stringField(obj: Record<string, unknown>, key: string): string {
    const value = obj[key];
    return typeof value === 'string' ? value.trim() : '';
}

function numberField(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function confidenceField(obj: Record<string, unknown>, fallback: number): number {
    const n = numberField(obj.confidence);
    if (n === null) return fallback;
    return Math.min(100, Math.max(0, Math.round(n)));
}

function riskField(obj: Record<string, unknown>, fallback: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
    const value = obj.risk;
    return value === 'low' || value === 'medium' || value === 'high' ? value : fallback;
}

function stringArrayField(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v) => v.trim())
        .slice(0, MAX_SOURCES_PER_PICK);
}

function isHttpUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
}

function oddsScoreOf(row: MatchRow): number {
    const odds = row.odds;
    if (!odds) return 0;
    const values = [odds.home, odds.away, odds.draw]
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v));
    return values.length > 0 ? Math.max(...values) : 0;
}

// --- Prompts ---

function buildAnalystUserPrompt(row: MatchRow): string {
    const context = [
        `id: ${row.id}`,
        `league: ${row.league}`,
        `homeTeam: ${row.home_team}`,
        `awayTeam: ${row.away_team}`,
        `timestamp: ${row.kickoff}`,
        `status: ${row.status}`,
        `score: ${row.score}`,
        row.odds ? `odds: ${JSON.stringify(row.odds)}` : null,
        row.details ? `details: ${JSON.stringify(row.details)}` : null,
    ].filter((v): v is string => v !== null);
    return `Analyze this football match:\n${context.join('\n')}\n\nReturn the pick as JSON.`;
}

function pickToJson(p: PerMatchResult): Record<string, unknown> {
    return {
        pick: p.pick,
        confidence: p.confidence,
        risk: p.risk,
        suggestedBet: p.suggestedBet,
        reasoning: p.reasoning,
        sources: p.sources,
    };
}

function buildVerifierUserPrompt(row: MatchRow, analystPick: PerMatchResult): string {
    return `Verify the analyst's pick for the match.\nMatch: ${row.home_team} vs ${row.away_team} (id: ${row.id}, league: ${row.league}, timestamp: ${row.kickoff})\nAnalyst output (JSON, including its sources): ${JSON.stringify(pickToJson(analystPick))}\n\nReturn the pick as JSON with the same shape as the analyst output.`;
}

// --- Parsing model output ---

function parseAnalystPick(content: string | null | undefined, row: MatchRow): PerMatchResult | null {
    if (typeof content !== 'string' || content.trim() === '') return null;
    const obj = extractJsonObject(content);
    if (!obj) return null;
    const pick = stringField(obj, 'pick') || stringField(obj, 'suggestedBet');
    if (pick === '') return null;
    return {
        matchId: row.id,
        pick,
        confidence: confidenceField(obj, 70),
        risk: riskField(obj, 'medium'),
        suggestedBet: stringField(obj, 'suggestedBet') || pick,
        reasoning: stringArrayField(obj.reasoning),
        sources: stringArrayField(obj.sources).filter(isHttpUrl),
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        league: row.league,
        timestamp: row.kickoff,
        oddsScore: oddsScoreOf(row),
    };
}

function parseVerifierPick(content: string | null | undefined, analystPick: PerMatchResult): PerMatchResult {
    if (typeof content === 'string') {
        const obj = extractJsonObject(content);
        if (obj) {
            const pick = stringField(obj, 'pick') || stringField(obj, 'suggestedBet') || analystPick.pick;
            const suggestedBet = stringField(obj, 'suggestedBet') || analystPick.suggestedBet || pick;
            const reasoning = stringArrayField(obj.reasoning);
            const sources = stringArrayField(obj.sources).filter(isHttpUrl);
            const out: PerMatchResult = {
                ...analystPick,
                pick,
                suggestedBet,
                risk: riskField(obj, analystPick.risk),
                confidence: confidenceField(obj, analystPick.confidence),
                reasoning: reasoning.length > 0 ? reasoning : analystPick.reasoning,
                sources: sources.length > 0 ? sources : analystPick.sources,
            };
            return out;
        }
    }
    return analystPick;
}

// --- Match analysis with web search (per match: analyst + verifier) ---

function proposalFromPick(pick: PerMatchResult): StoredProposal {
    return {
        matchId: pick.matchId,
        pick: pick.pick,
        confidence: pick.confidence,
        risk: pick.risk,
        suggestedBet: pick.suggestedBet,
        reasoning: pick.reasoning,
        sources: pick.sources.slice(0, MAX_SOURCES_PER_PICK),
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        league: pick.league,
        timestamp: pick.timestamp,
        oddsScore: pick.oddsScore,
    };
}

function pickFromProposal(proposal: StoredProposal): PerMatchResult {
    return {
        matchId: proposal.matchId,
        pick: proposal.pick,
        confidence: proposal.confidence,
        risk: proposal.risk,
        suggestedBet: proposal.suggestedBet,
        reasoning: proposal.reasoning,
        sources: proposal.sources,
        homeTeam: proposal.homeTeam,
        awayTeam: proposal.awayTeam,
        league: proposal.league,
        timestamp: proposal.timestamp,
        oddsScore: proposal.oddsScore,
    };
}

/** Store the proposals in analysis_results only. A run never writes to
 * matches — the Approve step (api/analysis/approve) is the only writer of
 * ai_prediction, tier and reasoning on matches. */
async function saveProposals(db: SupabaseClient, resultId: string, proposals: StoredProposal[]): Promise<void> {
    if (proposals.length === 0) return;
    const { data } = await db
        .from('analysis_results')
        .select('proposals')
        .eq('id', resultId)
        .single();
    const newIds = new Set(proposals.map((p) => p.matchId));
    const existing = ((data?.proposals as StoredProposal[] | null) ?? []).filter((p) => !newIds.has(p.matchId));
    const { error } = await db
        .from('analysis_results')
        .update({ proposals: [...existing, ...proposals] })
        .eq('id', resultId);
    if (error) throw new Error(`Failed to store proposals: ${error.message}`);
}

async function analyseMatch(
    row: MatchRow,
    apiKey: string,
): Promise<{ proposal: StoredProposal; calls: number }> {
    let calls = 0;
    // Analyst: web search ON — one call per match.
    const analystOut = await callDeepSeek(SYSTEM_PROMPT_ANALYST, buildAnalystUserPrompt(row), apiKey, {
        search: true,
        maxTokens: ANALYST_MAX_TOKENS,
    });
    calls += 1;
    const analystPick = parseAnalystPick(analystOut.content, row) ?? {
        matchId: row.id,
        pick: `${row.home_team} vs ${row.away_team}`,
        confidence: 70,
        risk: 'medium' as const,
        suggestedBet: 'Home Win',
        reasoning: [],
        sources: [],
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        league: row.league,
        timestamp: row.kickoff,
        oddsScore: oddsScoreOf(row),
    };
    // Verifier: web search OFF, analyst JSON + sources as input.
    const verifierOut = await callDeepSeek(
        SYSTEM_PROMPT_VERIFIER,
        buildVerifierUserPrompt(row, analystPick),
        apiKey,
        { search: false, maxTokens: VERIFIER_MAX_TOKENS },
    );
    calls += 1;
    const finalPick = parseVerifierPick(verifierOut.content, analystPick);
    return { proposal: proposalFromPick(finalPick), calls };
}

async function processChunk(
    db: SupabaseClient,
    matches: MatchRow[],
    apiKey: string,
    errors: string[],
): Promise<{ proposals: StoredProposal[]; calls: number }> {
    let next = 0;
    let fatal: DeepSeekApiError | null = null;
    const proposals: StoredProposal[] = [];
    let calls = 0;
    const worker = async (): Promise<void> => {
        while (fatal === null) {
            const idx = next;
            next += 1;
            if (idx >= matches.length) return;
            try {
                const result = await analyseMatch(matches[idx], apiKey);
                calls += result.calls;
                proposals.push(result.proposal);
            } catch (err) {
                if (err instanceof DeepSeekApiError && (err.status === 401 || err.status === 402)) {
                    fatal = err;
                    return;
                }
                errors.push(`${matches[idx].id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    };
    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < PARALLEL_WORKERS; i += 1) workers.push(worker());
    await Promise.all(workers);
    if (fatal) throw fatal;
    return { proposals, calls };
}

// --- Ranges and candidate discovery ---

function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Prioritise the trending leagues: match rows flagged trending, or with a
 * details.leagueId in the shared TRENDING_LEAGUES list, or whose league name
 * is (part of) a trending league name. */
function isTrendingRow(row: MatchRow): boolean {
    if (row.trending) return true;
    const details = (row.details ?? {}) as Record<string, unknown>;
    if (typeof details.leagueId === 'number' && TRENDING_LEAGUE_IDS.has(details.leagueId)) return true;
    const name = normalizeText(row.league);
    if (name === '') return false;
    return TRENDING_LEAGUES.some((tl) => {
        const tlName = normalizeText(tl.name);
        return tlName !== '' && (tlName.includes(name) || name.includes(tlName));
    });
}

function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Range for the selected analysis: daily = the date, weekly = the
 * Monday..Sunday week containing the date. */
function rangeFor(date: string, analysisType: 'daily' | 'weekly'): { start: string; end: string } {
    if (analysisType !== 'weekly') return { start: date, end: date };
    const d = new Date(`${date}T12:00:00Z`);
    const day = d.getUTCDay();
    const mondayOffset = day === 0 ? -6 : -((day + 6) % 7);
    const monday = new Date(d.getTime() + mondayOffset * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return { start: isoDate(monday), end: isoDate(sunday) };
}

async function getRangeMatches(db: SupabaseClient, start: string, end: string): Promise<MatchRow[]> {
    const { data } = await db.from('matches').select('*').gte('match_date', start).lte('match_date', end).limit(500);
    return (data ?? []) as MatchRow[];
}

/** Statuses meaning "Scheduled": matches whose status is anything else have
 * kicked off and are never picked. */
function isScheduledStatus(status: string): boolean {
    return status.trim().toUpperCase() === 'SCHEDULED';
}

/** Kickoff of a row as a timestamp. */
function kickoffMs(row: MatchRow): number {
    return new Date(row.kickoff).getTime();
}

/** Best-known leagues (top European, Champions/Europa, UAE/Saudi Pro),
 * matched case-insensitively as substrings — the "tier 2" priority after
 * trending rows. */
const BEST_KNOWN_LEAGUE_NAMES = [
    'English Premier League',
    'LaLiga',
    'Serie A',
    'Bundesliga',
    'Ligue 1',
    'Champions League',
    'Europa League',
    'Europa Conference League',
    'UAE Pro League',
    'Saudi Pro League',
    'English Championship',
    'Japanese J1 League',
    'Australian A-League',
    'USA MLS',
    'English FA Cup',
    'Africa Cup of Nations',
];

/** True when the match's league is one of the best-known leagues. */
function isBestKnownRow(row: MatchRow): boolean {
    const name = normalizeText(row.league);
    if (name === '') return false;
    return BEST_KNOWN_LEAGUE_NAMES.some((leagueName) => {
        const normalized = normalizeText(leagueName);
        return normalized !== '' && (normalized.includes(name) || name.includes(normalized));
    });
}

/** Matches with kickoff at least this far in the future are preferred. */
const FUTURE_KICKOFF_MS = 20 * 60 * 1000;

interface CandidateMatches {
    matches: MatchRow[];
    /** Candidates excluded because they had already started. */
    excludedStarted: number;
}

/** Run Analysis input: untagged, result-less, Scheduled matches in the
 * range; matches that have already started are never candidates. Order:
 * (a) kickoff at least 20 minutes in the future, then (b) trending rows
 * (TRENDING_LEAGUES or Trending flag), then the best-known leagues, then
 * (c) soonest kickoff. */
async function getCandidateMatches(db: SupabaseClient, start: string, end: string): Promise<CandidateMatches> {
    const rows = await getRangeMatches(db, start, end);
    const now = Date.now();
    const excludedStarted = rows.filter(
        (row) => row.tier === 'unassigned' && (row.result == null || row.result === 'pending') && kickoffMs(row) <= now,
    ).length;
    const candidates = rows.filter((row) =>
        row.tier === 'unassigned' &&
        (row.result == null || row.result === 'pending') &&
        isScheduledStatus(row.status) &&
        kickoffMs(row) > now,
    );
    const futureFloor = now + FUTURE_KICKOFF_MS;
    candidates.sort((a, b) => {
        const aKick = kickoffMs(a);
        const bKick = kickoffMs(b);
        const aFuture = aKick >= futureFloor;
        const bFuture = bKick >= futureFloor;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        const aTrending = Number(isTrendingRow(a));
        const bTrending = Number(isTrendingRow(b));
        if (aTrending !== bTrending) return bTrending - aTrending;
        const aKnown = Number(isBestKnownRow(a));
        const bKnown = Number(isBestKnownRow(b));
        if (aKnown !== bKnown) return bKnown - aKnown;
        return aKick - bKick;
    });
    return { matches: candidates, excludedStarted };
}

// --- Final ranking ---

const RISK_RANK: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 };

/** In-code ranking (deterministic): sort by confidence desc, ties lower
 * risk first then higher odds; assign tiers greedily — Free up to
 * FREE_COUNT, then VIP up to VIP_COUNT, then Paid up to PAID_COUNT. Picks
 * below MIN_TIP_CONFIDENCE get no tier and stay unassigned; when fewer than
 * 10 qualify the tiers are still filled in Free → VIP → Paid order. */
function rankPicksInCode(picks: PerMatchResult[]): TierSplit {
    const sorted = [...picks].sort(
        (a, b) =>
            b.confidence - a.confidence ||
            RISK_RANK[a.risk] - RISK_RANK[b.risk] ||
            (b.oddsScore ?? 0) - (a.oddsScore ?? 0),
    );
    const out: TierSplit = { free: [], vip: [], paid: [] };
    for (const pick of sorted) {
        if (pick.confidence < MIN_TIP_CONFIDENCE) continue;
        if (out.free.length < FREE_COUNT) {
            out.free.push(pick.matchId);
        } else if (out.vip.length < VIP_COUNT) {
            out.vip.push(pick.matchId);
        } else if (out.paid.length < PAID_COUNT) {
            out.paid.push(pick.matchId);
        } else {
            break;
        }
    }
    return out;
}

function toRecommendation(p: PerMatchResult, tier: Tier): Recommendation {
    return {
        matchId: p.matchId,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        league: p.league,
        timestamp: p.timestamp,
        recommendedType: tier,
        confidence: p.confidence,
        reasoning: p.reasoning,
        suggestedBet: p.suggestedBet,
        riskLevel: p.risk,
        risk: p.risk,
        sources: p.sources,
        pick: p.pick,
    };
}

function pickById(picks: PerMatchResult[], matchId: string): PerMatchResult {
    const pick = picks.find((p) => p.matchId === matchId);
    if (!pick) throw new Error(`Ranked pick not found: ${matchId}`);
    return pick;
}

async function ensureAnalysisResultRow(
    db: SupabaseClient,
    date: string,
    analysisType: 'daily' | 'weekly',
): Promise<AnalysisResult> {
    const { data: existing } = await db
        .from('analysis_results')
        .select('*')
        .eq('date', date)
        .eq('analysis_type', analysisType)
        .limit(1);
    if (existing && existing.length > 0) return mapAnalysisResult(existing[0] as AnalysisResultRow);

    const now = new Date().toISOString();
    const { error } = await db.from('analysis_results').insert({
        date,
        analysis_type: analysisType,
        status: 'verified',
        free_recommendations: [],
        paid_recommendations: [],
        vip_recommendations: [],
        model: DEEPSEEK_FLASH_MODEL,
        generated_at: now,
        created_at: now,
    });
    if (error) {
        throw new Error(`Failed to create analysis result: ${error.message}`);
    }
    const { data: rows } = await db
        .from('analysis_results')
        .select('*')
        .eq('date', date)
        .eq('analysis_type', analysisType)
        .order('created_at', { ascending: false })
        .limit(1);
    const row = (rows && rows[0]) as AnalysisResultRow | undefined;
    if (!row) {
        throw new Error(`Failed to create analysis result: row not returned`);
    }
    return mapAnalysisResult(row);
}

async function maybeCompleteRanking(
    db: SupabaseClient,
    date: string,
    analysisType: 'daily' | 'weekly',
): Promise<{ ranked: TierSplit; analysed: number }> {
    const row = await ensureAnalysisResultRow(db, date, analysisType);
    const { data } = await db
        .from('analysis_results')
        .select('proposals')
        .eq('id', row._id)
        .single();
    const picks = ((data?.proposals as StoredProposal[] | null) ?? []).map(pickFromProposal);

    const split: TierSplit = picks.length > 0 ? rankPicksInCode(picks) : { free: [], vip: [], paid: [] };

    const now = new Date().toISOString();
    const { error } = await db
        .from('analysis_results')
        .update({
            free_recommendations: split.free.map((id) => toRecommendation(pickById(picks, id), 'free')),
            paid_recommendations: split.paid.map((id) => toRecommendation(pickById(picks, id), 'paid')),
            vip_recommendations: split.vip.map((id) => toRecommendation(pickById(picks, id), 'vip')),
            updated_at: now,
        })
        .eq('id', row._id);
    if (error) throw new Error(`Failed to store ranked split: ${error.message}`);

    return { ranked: split, analysed: picks.length };
}

// --- Run endpoint entry point ---

/** One "run": process at most CHUNK_SIZE matches; the page repeats this
 * until state === 'complete'. Safe to retry: matches with a stored proposal
 * are excluded from future chunks (unless rerun). Proposals are stored in
 * analysis_results.proposals — matches are only written by the Approve
 * step. */
export async function processRunChunk(
    db: SupabaseClient,
    date: string,
    analysisType: 'daily' | 'weekly',
    rerun: boolean,
    maxMatches = MAX_MATCHES,
): Promise<RunChunkResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new DeepSeekApiError(500, 'DEEPSEEK_API_KEY is not configured');

    const { start, end } = rangeFor(date, analysisType);
    const arRow = await ensureAnalysisResultRow(db, date, analysisType);
    const storedIds = new Set((arRow.proposals ?? []).map((p) => p.matchId));

    const candidates = await getCandidateMatches(db, start, end);
    const limited = candidates.matches.slice(0, maxMatches);
    const errors: string[] = [];

    // A rerun redoes the matches; a normal run skips ones already analysed.
    const toDo = limited.filter((m) => rerun || !storedIds.has(m.id));
    const skipped = rerun ? 0 : limited.filter((m) => storedIds.has(m.id)).length;

    let processedCount = 0;
    let deepseekCalls = 0;
    if (toDo.length > 0) {
        const chunk = toDo.slice(0, CHUNK_SIZE);
        const chunkResult = await processChunk(db, chunk, apiKey, errors);
        deepseekCalls = chunkResult.calls;
        // Store the proposals while the run is in progress; matches are
        // untouched — the Approve step publishes them.
        await saveProposals(db, arRow._id, chunkResult.proposals);
        processedCount = chunk.length;
    }

    const { data } = await db
        .from('analysis_results')
        .select('proposals')
        .eq('id', arRow._id)
        .single();
    const analysed = ((data?.proposals as StoredProposal[] | null) ?? []).length;

    const base = {
        total: limited.length,
        analysed,
        errors,
        excludedStarted: candidates.excludedStarted,
        skipped,
        deepseekCalls,
    };
    if (toDo.length === 0 || processedCount === 0) {
        const complete = await maybeCompleteRanking(db, date, analysisType);
        return { state: 'complete', ...base, complete };
    }
    return { state: 'running', ...base };
}

export { DeepSeekApiError };
