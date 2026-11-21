import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFixturePrediction, type ApiFixturePrediction } from '../api-football-predictions';
import { syncFixtures } from '../sync-fixtures';
import { createAlert } from './alerts';
import { getById } from './matches';
import type { AiPrediction, MatchRow, MatchTier } from './types';

// --- DeepSeek config (ports packages/backend/convex/analysis.ts) ---

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// --- Automated daily picks (stored af-* matches → DeepSeek) ---

/** Read an env var as a number with a fallback when unset or non-numeric. */
function envNumber(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** Confidence floor: picks below this are dropped after the DeepSeek
 * verifier, before ranking. */
export const MIN_CONFIDENCE = envNumber('MIN_CONFIDENCE', 65);

/** Tier sizes when ranking the kept picks: top VIP_COUNT → vip, next
 * PAID_COUNT → paid, next FREE_COUNT → free. */
export const VIP_COUNT = envNumber('VIP_COUNT', 3);
export const PAID_COUNT = envNumber('PAID_COUNT', 4);
export const FREE_COUNT = envNumber('FREE_COUNT', 3);

/** Max /predictions?fixture= calls per run. */
export const MAX_PREDICTION_CALLS = envNumber('MAX_PREDICTION_CALLS', 25);

/** Names of the priority competitions: top European leagues, Champions and
 * Europa Leagues, the UAE Pro League and the Saudi Pro League. */
const PRIORITY_LEAGUE_NAMES = [
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
];

/** Names are matched case- and whitespace-insensitively: the stored league
 * names sometimes spell the UAE/Saudi Pro Leagues as "Pro League"
 * (distinguished by the country stored by syncFixtures). */
function normalizeLeagueName(value: string): string {
    return value.toLowerCase().replace(/\s+/g, '');
}

/** True when a stored match's league is a priority competition: by name, or
 * the UAE/Saudi Pro Leagues stored as "Pro League" (country match). */
function isPriorityStoredMatch(match: StoredMatchContext): boolean {
    const name = normalizeLeagueName(match.league);
    const country = normalizeLeagueName(match.country ?? '');
    for (const priorityName of PRIORITY_LEAGUE_NAMES) {
        const normalized = normalizeLeagueName(priorityName);
        if (normalized === name) return true;
        if (normalized === 'uaeproleague' && name === 'proleague' && country.includes('emirates')) return true;
        if (normalized === 'saudiproleague' && name === 'proleague' && country.includes('saudi')) return true;
    }
    return false;
}

/** Statuses that mean "not started yet" — anything else has kicked off.
 * 'SCHEDULED' is included because syncFixtures stores upcoming fixtures as
 * status "Scheduled". */
const NOT_STARTED_STATUSES = ['', 'NS', 'TBD', 'Canc', 'PPD', 'Not Started', 'SCHEDULED'];

/** True when the status means the match has not kicked off yet. */
function isStatusStarted(status: string): boolean {
    return !NOT_STARTED_STATUSES.includes(status.trim().toUpperCase());
}

/** Allowed markets for picks: every market the final score can grade. */
const ALLOWED_MARKETS = [
    'Home Win',
    'Away Win',
    'Draw',
    'Double Chance 1X',
    'Double Chance X2',
    'Over 2.5 Goals',
    'Under 2.5 Goals',
    'Both Teams To Score',
];

const SYSTEM_PROMPT_API_ANALYST = `You are an elite football betting analyst with 15+ years of experience. You are given a shortlist of football fixtures with API-Football predicted percents, advice and form.

For each recommended fixture provide:
1. fixtureId (exact id from input)
2. homeTeam, awayTeam, league, time
3. suggestedBet: one of the allowed markets only (Home Win, Away Win, Draw, Double Chance 1X, Double Chance X2, Over 2.5 Goals, Under 2.5 Goals, Both Teams To Score)
4. confidence: 1-100 (data-driven, not arbitrary)
5. reasoning: 2-4 short analytical points as an array of strings
6. keyStats: 2-3 supporting statistics as an array of strings
7. riskLevel: "low", "medium", or "high"

Rules:
- Only suggest markets that can be graded from the final score.
- Do not invent data; base everything on the provided input.
- If you cannot support a pick, do not include it.
- Return ONLY valid JSON: { "picks": [...] }`;

const SYSTEM_PROMPT_API_VERIFIER = `You are a senior betting verification analyst. Your job is to double-check recommendations and remove any that lack sufficient evidence or have inflated confidence scores. Be conservative.

Remove picks where:
- Confidence doesn't match the reasoning quality or the input data
- The market is not gradeable from the final score
- Key stats don't support the recommendation

Return ONLY valid JSON:
{
  "verified": true/false,
  "adjustedRecommendations": [{ fixtureId, homeTeam, awayTeam, league, time, suggestedBet, confidence, reasoning, keyStats, riskLevel }],
  "removedMatches": [{ fixtureId, reason }],
  "verificationNotes": ["..."]
}`;

// --- Types (match the Convex analysisResults doc shape) ---

export type AnalysisType = 'daily' | 'weekly';
export type AnalysisStatus = 'pending' | 'verified' | 'approved' | 'rejected';

/** Per-match proposal produced by a Run Analysis (web search analyst +
 * verifier). Stored in analysis_results.proposals while the run is in
 * progress; matches.ai_prediction is written only by the Approve step. */
export interface StoredProposal {
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

export interface Recommendation {
    matchId: string;
    homeTeam?: string;
    awayTeam?: string;
    league?: string;
    timestamp?: string;
    recommendedType?: 'free' | 'paid' | 'vip';
    confidence: number;
    reasoning: string[];
    suggestedBet?: string;
    keyStats?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    risk?: 'low' | 'medium' | 'high';
    sources?: string[];
    pick?: string;
}

export interface RemovedMatch {
    matchId: string;
    reason?: string;
}

export interface AnalysisResult {
    _id: string;
    date: string;
    analysisType: AnalysisType;
    status: AnalysisStatus;
    freeRecommendations: Recommendation[];
    paidRecommendations: Recommendation[];
    vipRecommendations: Recommendation[];
    /** Per-match proposals captured while the run was in progress. */
    proposals: StoredProposal[];
    verificationNotes?: string[];
    removedMatches?: RemovedMatch[];
    confidenceAdjustment?: number;
    model: string;
    generatedAt: string;
    verifiedAt?: string;
    approvedAt?: string;
    approvedBy?: string;
    createdAt: string;
    updatedAt?: string;
}

export interface AnalysisResultRow {
    id: string;
    date: string;
    analysis_type: AnalysisType;
    status: AnalysisStatus;
    free_recommendations: Recommendation[];
    paid_recommendations: Recommendation[];
    vip_recommendations: Recommendation[];
    proposals: StoredProposal[] | null;
    verification_notes: string[] | null;
    removed_matches: RemovedMatch[] | null;
    confidence_adjustment: number | null;
    model: string;
    generated_at: string;
    verified_at: string | null;
    approved_at: string | null;
    approved_by: string | null;
    created_at: string;
    updated_at: string | null;
}

export function mapAnalysisResult(row: AnalysisResultRow): AnalysisResult {
    return {
        _id: row.id,
        date: row.date,
        analysisType: row.analysis_type,
        status: row.status,
        freeRecommendations: row.free_recommendations ?? [],
        paidRecommendations: row.paid_recommendations ?? [],
        vipRecommendations: row.vip_recommendations ?? [],
        proposals: row.proposals ?? [],
        verificationNotes: row.verification_notes ?? undefined,
        removedMatches: row.removed_matches ?? undefined,
        confidenceAdjustment: row.confidence_adjustment ?? undefined,
        model: row.model,
        generatedAt: row.generated_at,
        verifiedAt: row.verified_at ?? undefined,
        approvedAt: row.approved_at ?? undefined,
        approvedBy: row.approved_by ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at ?? undefined,
    };
}

// --- Queries (ports of Convex api.analysis) ---

/** analysis.getByDate — latest result stored for a date. */
export async function getByDate(db: SupabaseClient, date: string): Promise<AnalysisResult | null> {
    const { data } = await db
        .from('analysis_results')
        .select('*')
        .eq('date', date)
        .limit(1);
    if (!data || data.length === 0) return null;
    return mapAnalysisResult(data[0] as AnalysisResultRow);
}

/** analysis.getAll — analysis results, newest first. */
export async function getAll(db: SupabaseClient, limit = 50): Promise<AnalysisResult[]> {
    const { data } = await db
        .from('analysis_results')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    return ((data ?? []) as AnalysisResultRow[]).map(mapAnalysisResult);
}

/** Port of Convex api.analysis.approveAnalysis — tag matches with the
 * recommended type + AI prediction from each category's recommendations. */
export async function approveAnalysis(
    db: SupabaseClient,
    input: {
        resultId: string;
        approvedBy: string;
        selectedMatchIds?: string[];
        approveFree?: boolean;
        approvePaid?: boolean;
        approveVip?: boolean;
    },
): Promise<{ success: true; applied: number }> {
    const { data } = await db
        .from('analysis_results')
        .select('*')
        .eq('id', input.resultId)
        .limit(1);
    const result = data && data.length > 0 ? mapAnalysisResult(data[0] as AnalysisResultRow) : null;
    if (!result) throw new Error('Analysis result not found');

    const now = new Date().toISOString();
    const selectedSet = input.selectedMatchIds ? new Set(input.selectedMatchIds) : null;
    let applied = 0;

    const applyType = async (recommendations: Recommendation[], type: 'free' | 'paid' | 'vip'): Promise<void> => {
        for (const rec of recommendations) {
            if (selectedSet && !selectedSet.has(rec.matchId)) continue;
            const existing = await getById(db, rec.matchId);
            if (!existing) {
                console.warn(`[ApproveAnalysis] Match ${rec.matchId} not found`);
                continue;
            }
            // The Approve step is the only writer of ai_prediction and tier on
            // matches: never touch a match that is not untagged or that
            // already has a result.
            if (existing.matchType === 'free' || existing.matchType === 'vip' || existing.matchType === 'paid') continue;
            if (existing.result) continue;
            // Merge into the existing aiPrediction so partial updates never
            // erase existing fields (risk, sources, pick, ...).
            const previous = existing.aiPrediction ?? {};
            const aiPrediction: AiPrediction = {
                ...previous,
                prediction: `${rec.homeTeam} vs ${rec.awayTeam} — ${rec.suggestedBet}`,
                confidence: rec.confidence,
                reasoning: rec.reasoning || [],
                suggestedBet: rec.suggestedBet,
                generatedAt: now,
                ...(rec.risk ? { risk: rec.risk } : {}),
                ...(rec.sources && rec.sources.length > 0 ? { sources: rec.sources.slice(0, 3) } : {}),
                ...(rec.pick ? { pick: rec.pick } : {}),
            };
            await db
                .from('matches')
                .update({ tier: type, ai_prediction: aiPrediction })
                .eq('id', existing._id);
            applied++;
        }
    };

    if (selectedSet) {
        // Individual selection mode: check all categories for selected matches.
        await applyType(result.freeRecommendations, 'free');
        await applyType(result.paidRecommendations, 'paid');
        await applyType(result.vipRecommendations, 'vip');
    } else {
        // Legacy category mode.
        if (input.approveFree !== false) await applyType(result.freeRecommendations, 'free');
        if (input.approvePaid !== false) await applyType(result.paidRecommendations, 'paid');
        if (input.approveVip !== false) await applyType(result.vipRecommendations, 'vip');
    }

    await db
        .from('analysis_results')
        .update({ status: 'approved', approved_at: now, approved_by: input.approvedBy, updated_at: now })
        .eq('id', result._id);

    return { success: true, applied };
}

// --- DeepSeek port (api.analysis.runAnalysis — automated daily picks) ---

interface DeepSeekResponse {
    choices?: Array<{ message?: { content?: string } }>;
}

/** Parsed DeepSeek JSON output (analyst/verifier) for the automated flow. */
type DeepSeekOutput = Record<string, unknown>;

async function callDeepSeek(systemPrompt: string, userPrompt: string, apiKey: string): Promise<DeepSeekOutput> {
    const res = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 12000,
            response_format: { type: 'json_object' },
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`DeepSeek API ${res.status}: ${text}`);
    }

    const json = (await res.json()) as DeepSeekResponse;
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty DeepSeek response');

    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('DeepSeek response is not a JSON object');
    }
    return parsed as DeepSeekOutput;
}

// --- Type guards / parsers for DeepSeek output ---

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function trimmed(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v !== '');
}

function normalizedConfidence(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.min(100, Math.max(0, Math.round(value)));
}

/** Pick as produced by the DeepSeek analyst (or verifier-adjusted output). */
interface BatchedPick {
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    time: string;
    suggestedBet: string;
    confidence: number;
    reasoning: string[];
    keyStats: string[];
    riskLevel: 'low' | 'medium' | 'high';
}

/** Pick after the confidence floor and tier ranking. */
interface RankedPick extends Omit<BatchedPick, 'keyStats'> {
    tier: PickTier;
}

export type PickTier = 'vip' | 'paid' | 'free';

function parsePicks(value: unknown): BatchedPick[] {
    if (!Array.isArray(value)) return [];
    const picks: BatchedPick[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) continue;
        const fixtureId = trimmed(entry.fixtureId) || (typeof entry.fixtureId === 'number' ? String(entry.fixtureId) : '');
        const suggestedBet = trimmed(entry.suggestedBet);
        const confidence = normalizedConfidence(entry.confidence);
        if (fixtureId === '' || suggestedBet === '' || confidence === undefined) continue;
        const riskLevel = entry.riskLevel;
        picks.push({
            fixtureId,
            homeTeam: trimmed(entry.homeTeam),
            awayTeam: trimmed(entry.awayTeam),
            league: trimmed(entry.league),
            time: trimmed(entry.time),
            suggestedBet,
            confidence,
            reasoning: stringArray(entry.reasoning),
            keyStats: stringArray(entry.keyStats),
            riskLevel: riskLevel === 'low' || riskLevel === 'high' ? riskLevel : 'medium',
        });
    }
    return picks;
}

function parseRemovedMatches(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) continue;
        const fixtureId = trimmed(entry.fixtureId) || (typeof entry.fixtureId === 'number' ? String(entry.fixtureId) : '');
        if (fixtureId !== '') out.push(fixtureId);
    }
    return out;
}

// --- Prompts for the automated flow ---

function describePrediction(prediction: ApiFixturePrediction | undefined): string {
    const parts: string[] = [];
    const percent = prediction?.percent;
    if (percent) {
        const values = [
            percent.home !== undefined ? `home ${percent.home}%` : null,
            percent.draw !== undefined ? `draw ${percent.draw}%` : null,
            percent.away !== undefined ? `away ${percent.away}%` : null,
        ].filter((v): v is string => v !== null);
        if (values.length > 0) parts.push(`API percents: ${values.join(', ')}`);
    }
    if (prediction?.advice) parts.push(`API advice: ${prediction.advice}`);
    const form = prediction?.form;
    if (form && (form.home !== undefined || form.away !== undefined)) {
        parts.push(`API form: home ${form.home ?? '?'} / away ${form.away ?? '?'}`);
    }
    return parts.join(' | ');
}

function hasPredictionData(prediction: ApiFixturePrediction): boolean {
    if (prediction.advice && prediction.advice.length > 0) return true;
    const percent = prediction.percent;
    if (percent && (percent.home !== undefined || percent.draw !== undefined || percent.away !== undefined)) return true;
    const form = prediction.form;
    return Boolean(form && (form.home !== undefined || form.away !== undefined));
}

function buildAnalystPrompt(shortlist: StoredMatchContext[], predictions: Map<number, ApiFixturePrediction>): string {
    const lines = shortlist.map((m) => {
        const prediction = predictions.get(m.id);
        const detail = describePrediction(prediction);
        const base = [
            String(m.id),
            `${m.homeTeam} vs ${m.awayTeam}`,
            `| ${m.league}`,
            `| ${m.date}`,
        ];
        if (detail) base.push(`| ${detail}`);
        return base.join(' ');
    });
    return `Analyze ${shortlist.length} football fixtures from the list below and suggest the best picks. Use the API-Football percents, advice and form where present.

Allowed markets (ONLY these can be graded from the final score): ${ALLOWED_MARKETS.join(', ')}.

Return JSON:
{
  "picks": [{ "fixtureId": "id", "homeTeam": "...", "awayTeam": "...", "league": "...", "time": "...", "suggestedBet": "Home Win", "confidence": 78, "reasoning": ["..."], "keyStats": ["..."], "riskLevel": "medium" }]
}

Fixtures:
${lines.join('\n')}`;
}

function buildVerifierPrompt(picks: BatchedPick[]): string {
    const lines = picks.map((pick, i) =>
        `${i + 1}. ${pick.fixtureId} | ${pick.homeTeam} vs ${pick.awayTeam} | ${pick.league} | ${pick.suggestedBet} | conf ${pick.confidence} | risk ${pick.riskLevel} | ${pick.reasoning.join('; ')}`,
    );
    return `Verify these ${picks.length} recommendations. Be conservative; remove picks without evidence. Each pick must have a short reasoning and a confidence consistent with the input.

Return JSON:
{
  "verified": true/false,
  "adjustedRecommendations": [same shape as the picks],
  "removedMatches": [{ "fixtureId": "id", "reason": "why removed" }],
  "verificationNotes": ["..."]
}

Picks:
${lines.join('\n')}`;
}

/** A stored af-* match as used by the DeepSeek prompts and ranking — the
 * analogue of the old ApiFootballFixture shortlist, now read from the
 * matches table (lib/sync-fixtures.ts). */
interface StoredMatchContext {
    /** Parsed API-Football fixture id (matches.external_id is `af-<id>`). */
    id: number;
    /** matches.external_id (`af-<id>`). */
    externalId: string;
    /** matches.id (the Supabase uuid). */
    dbId: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    /** Country from details (stored by syncFixtures). */
    country?: string;
    /** Kickoff (matches.kickoff). */
    date: string;
    status: string;
}

/** Country of a stored match from the details jsonb (undefined when unset). */
function storedCountry(row: MatchRow): string | undefined {
    const value = row.details?.country;
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The stored matches to analyse for a date: rows with an `af-` external id
 * and tier 'unassigned' that have no prediction yet and are not started. */
async function getStoredPendingMatches(db: SupabaseClient, date: string): Promise<StoredMatchContext[]> {
    const { data } = await db
        .from('matches')
        .select('*')
        .like('external_id', 'af-%')
        .eq('tier', 'unassigned')
        .is('ai_prediction', null)
        .eq('match_date', date)
        .order('kickoff', { ascending: true })
        .limit(MAX_PREDICTION_CALLS);

    const contexts: StoredMatchContext[] = [];
    for (const row of (data ?? []) as MatchRow[]) {
        const externalId = row.external_id ?? '';
        const id = Number(externalId.slice(3));
        if (!Number.isInteger(id) || id <= 0) continue;
        if (isStatusStarted(row.status)) continue;
        contexts.push({
            id,
            externalId,
            dbId: row.id,
            homeTeam: row.home_team,
            awayTeam: row.away_team,
            league: row.league,
            country: storedCountry(row),
            date: row.kickoff,
            status: row.status,
        });
    }
    return contexts;
}

/** Picks proposed for publication when AUTO_PUBLISH is "false": they are
 * created as unassigned matches, and the Analysis page offers "Publish
 * all" to apply the proposed tiers. */
export interface ProposedPick {
    externalId: string;
    fixtureId: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    tier: PickTier;
    confidence: number;
    suggestedBet: string;
}

export interface RunAutomatedAnalysisResult {
    /** Stored af- matches for the date (read before analysis). */
    fixturesFound: number;
    /** Shortlisted matches (priority first), capped at MAX_PREDICTION_CALLS. */
    shortlisted: number;
    predictionsOk: number;
    predictionsFailed: number;
    /** Picks kept by the verifier with confidence ≥ MIN_CONFIDENCE and ranked. */
    analysed: number;
    published: { vip: number; paid: number; free: number; unassigned: number };
    autoPublished: boolean;
    proposedPicks: ProposedPick[];
    errors: string[];
    verified: boolean;
    removedCount: number;
}

/** Automated daily picks run: read the STORED af- matches for the date
 * (sync them via syncFixtures first when none are stored), shortlist
 * (priority matches first), fetch /predictions for each, send the shortlist
 * (with API percentages/advice/form) to the DeepSeek analyst + verifier in
 * ONE batched call, keep picks with confidence ≥ MIN_CONFIDENCE, rank them
 * (VIP_COUNT → vip, PAID_COUNT → paid, FREE_COUNT → free) and UPDATE the
 * existing stored rows (tier, ai_prediction) — no duplicate inserts. */
export async function runAutomatedAnalysis(
    db: SupabaseClient,
    input: { date: string },
): Promise<RunAutomatedAnalysisResult> {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error('API_FOOTBALL_KEY not configured');
    const errors: string[] = [];

    // 1. Read the STORED af- matches for the date (tier 'unassigned', no
    //    prediction yet, not started). Sync first only if none are stored.
    let stored = await getStoredPendingMatches(db, input.date);
    if (stored.length === 0) {
        const sync = await syncFixtures(db, input.date);
        errors.push(...sync.errors);
        stored = await getStoredPendingMatches(db, input.date);
    }
    const fixturesFound = stored.length;
    if (fixturesFound === 0) throw new Error(`No fixtures found for ${input.date}`);
    const byExternalId = new Map(stored.map((m) => [m.externalId, m]));

    // 2. Shortlist: priority matches first, then the rest; cap at
    //    MAX_PREDICTION_CALLS.
    const prioritySet = new Set(stored.filter(isPriorityStoredMatch).map((m) => m.id));
    const shortlist = [
        ...stored.filter((m) => prioritySet.has(m.id)),
        ...stored.filter((m) => !prioritySet.has(m.id)),
    ].slice(0, MAX_PREDICTION_CALLS);
    const shortlisted = shortlist.length;

    // 3. /predictions?fixture= for each shortlisted match (≤ MAX_PREDICTION_CALLS).
    const predictions = new Map<number, ApiFixturePrediction>();
    for (const match of shortlist) {
        const result = await fetchFixturePrediction(match.id);
        if (result.ok && result.prediction && hasPredictionData(result.prediction)) {
            predictions.set(match.id, result.prediction);
        } else {
            errors.push(`predictions ${match.id}: ${result.error ?? 'no prediction returned'}`);
        }
    }
    const predictionsOk = predictions.size;
    const predictionsFailed = shortlist.length - predictionsOk;

    // 4. ONE batched DeepSeek call: analyst, then verifier.
    const analystOut = await callDeepSeek(SYSTEM_PROMPT_API_ANALYST, buildAnalystPrompt(shortlist, predictions), apiKey);
    const analystPicks = parsePicks(analystOut.picks);
    const verifierOut = await callDeepSeek(SYSTEM_PROMPT_API_VERIFIER, buildVerifierPrompt(analystPicks), apiKey);
    const verifierPicks = parsePicks(verifierOut.adjustedRecommendations);
    const verified = typeof verifierOut.verified === 'boolean' ? verifierOut.verified : false;
    const removedCount = parseRemovedMatches(verifierOut.removedMatches).length;

    // 5. Keep picks with confidence ≥ MIN_CONFIDENCE; rank: top VIP_COUNT
    //    → vip, next PAID_COUNT → paid, next FREE_COUNT → free.
    const seen = new Set<string>();
    const sorted: BatchedPick[] = [];
    for (const pick of verifierPicks) {
        if (pick.confidence < MIN_CONFIDENCE || seen.has(pick.fixtureId)) continue;
        seen.add(pick.fixtureId);
        sorted.push(pick);
    }
    sorted.sort((a, b) => b.confidence - a.confidence);
    const rankedPicks: RankedPick[] = [];
    const tierBudgets: Array<[PickTier, number]> = [['vip', VIP_COUNT], ['paid', PAID_COUNT], ['free', FREE_COUNT]];
    for (const [tier, budget] of tierBudgets) {
        for (let i = 0; i < budget; i += 1) {
            const pick = sorted.shift();
            if (!pick) break;
            rankedPicks.push({ ...pick, tier });
        }
    }

    // 6. UPDATE the stored rows (tier, ai_prediction) instead of inserting duplicates.
    const autoPublish = process.env.AUTO_PUBLISH?.toLowerCase() !== 'false';
    const updateOutcome = await updateStoredPicks(db, rankedPicks, autoPublish, byExternalId);
    errors.push(...updateOutcome.errors);

    // 7. At most one summary alert per run, only if SEND_SUMMARY_ALERT is "true".
    if (process.env.SEND_SUMMARY_ALERT?.toLowerCase() === 'true') {
        try {
            await createAlert(db, {
                title: 'Daily Picks Ready',
                body: `Analysed ${rankedPicks.length} fixtures — published ${updateOutcome.vip + updateOutcome.paid + updateOutcome.free} picks (VIP ${updateOutcome.vip}, Paid ${updateOutcome.paid}, Free ${updateOutcome.free}).`,
            });
        } catch (alertError) {
            errors.push(`summary alert: ${alertError instanceof Error ? alertError.message : String(alertError)}`);
        }
    }

    console.log(`[AnalysisRun] Done for ${input.date}: stored=${fixturesFound} shortlisted=${shortlisted} predictions=${predictionsOk}/${predictionsFailed} picks=${rankedPicks.length} updated=${updateOutcome.vip + updateOutcome.paid + updateOutcome.free + updateOutcome.unassigned}`);

    return {
        fixturesFound,
        shortlisted,
        predictionsOk,
        predictionsFailed,
        analysed: rankedPicks.length,
        published: {
            vip: updateOutcome.vip,
            paid: updateOutcome.paid,
            free: updateOutcome.free,
            unassigned: autoPublish ? 0 : updateOutcome.unassigned,
        },
        autoPublished: autoPublish,
        proposedPicks: autoPublish
            ? []
            : rankedPicks.map((pick) => ({
                externalId: `af-${pick.fixtureId}`,
                fixtureId: pick.fixtureId,
                homeTeam: pick.homeTeam,
                awayTeam: pick.awayTeam,
                league: pick.league,
                tier: pick.tier,
                confidence: pick.confidence,
                suggestedBet: pick.suggestedBet,
            })),
        errors,
        verified,
        removedCount,
    };
}

/** Outcome of updateStoredPicks. */
interface UpdatePicksOutcome {
    vip: number;
    paid: number;
    free: number;
    unassigned: number;
    errors: string[];
}

/** UPDATE the stored af-* rows (tier, ai_prediction) for the ranked picks.
 * The rows were stored by syncFixtures and are still tier 'unassigned', so
 * this updates rather than duplicating them. Rows that are missing are
 * skipped. */
async function updateStoredPicks(
    db: SupabaseClient,
    picks: RankedPick[],
    autoPublish: boolean,
    byExternalId: Map<string, StoredMatchContext>,
): Promise<UpdatePicksOutcome> {
    const outcome: UpdatePicksOutcome = { vip: 0, paid: 0, free: 0, unassigned: 0, errors: [] };
    const now = new Date().toISOString();

    for (const pick of picks) {
        const externalId = `af-${pick.fixtureId}`;
        const stored = byExternalId.get(externalId);
        if (!stored) {
            outcome.errors.push(`no stored match for ${externalId}`);
            continue;
        }
        const tier: MatchTier = autoPublish ? pick.tier : 'unassigned';
        const { error } = await db
            .from('matches')
            .update({
                tier,
                ai_prediction: {
                    prediction: `${pick.homeTeam} vs ${pick.awayTeam} — ${pick.suggestedBet}`,
                    confidence: pick.confidence,
                    reasoning: pick.reasoning,
                    suggestedBet: pick.suggestedBet,
                    generatedAt: now,
                },
            })
            .eq('id', stored.dbId);
        if (error) {
            const message = error.message || 'unknown update error';
            outcome.errors.push(`update ${externalId}: ${message}`);
            console.error(`[AnalysisRun] Update failed for ${externalId}:`, message);
            continue;
        }
        if (autoPublish) outcome[pick.tier] += 1;
        else outcome.unassigned += 1;
    }
    return outcome;
}

/** Publish proposed picks: apply the proposed tier to matches that are still
 * 'unassigned' (the "Publish all" button on the Analysis page). */
export async function publishProposedPicks(
    db: SupabaseClient,
    picks: Array<{ externalId: string; tier: PickTier }>,
): Promise<{ applied: number; errors: string[] }> {
    const errors: string[] = [];
    let applied = 0;
    const byExternalId = new Map<string, PickTier>();
    for (const pick of picks) byExternalId.set(pick.externalId, pick.tier);

    for (const [externalId, tier] of byExternalId) {
        const existing = await getById(db, externalId);
        if (!existing) {
            errors.push(`match ${externalId} not found`);
            continue;
        }
        if (existing.matchType === 'unassigned') {
            const { error } = await db.from('matches').update({ tier }).eq('id', existing._id);
            if (error) errors.push(`${externalId}: ${error.message}`);
            else applied += 1;
        }
    }
    return { applied, errors };
}

/** Analysis tier applied by approveAnalysis (type tag written to matches). */
export type AnalysisTier = MatchTier;
