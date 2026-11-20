import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFixtures, type ApiFootballFixture } from '../api-football';
import { fetchFixturePrediction, type ApiFixturePrediction } from '../api-football-predictions';
import { createAlert } from './alerts';
import { getById } from './matches';
import type { DbMatch, MatchTier } from './types';

// --- DeepSeek config (ports packages/backend/convex/analysis.ts) ---

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// --- Automated daily picks (API-Football → DeepSeek) ---

/** Confidence floor: picks below this are dropped after the DeepSeek
 * verifier, before ranking. */
export const MIN_CONFIDENCE = 65;

/** Tier sizes when ranking the kept picks: top VIP_COUNT → vip, next
 * PAID_COUNT → paid, next FREE_COUNT → free. */
export const VIP_COUNT = 3;
export const PAID_COUNT = 4;
export const FREE_COUNT = 3;

/** Max /predictions?fixture= calls per run. */
export const MAX_PREDICTION_CALLS = 25;

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

/** Ids of the priority competitions, in priority order — derived from the
 * fixtures response by name (see derivePriorityIds); the run logs which
 * were found. */
export const PRIORITY_LEAGUE_IDS: number[] = [];

/** Names are matched case- and whitespace-insensitively: the API sometimes
 * writes "LaLiga", "LaLiga" or the UAE/Saudi Pro Leagues as "Pro League"
 * (distinguished by country). */
function normalizeLeagueName(value: string): string {
    return value.toLowerCase().replace(/\s+/g, '');
}

function leagueMatchesPriority(fixture: ApiFootballFixture, name: string): boolean {
    if (normalizeLeagueName(fixture.league.name) === normalizeLeagueName(name)) return true;
    const leagueName = fixture.league.name.toLowerCase();
    const country = fixture.league.country.toLowerCase();
    const normalized = normalizeLeagueName(name);
    if (normalized === 'uaeproleague' && leagueName === 'pro league' && country.includes('emirates')) return true;
    if (normalized === 'saudiproleague' && leagueName === 'pro league' && country.includes('saudi')) return true;
    return false;
}

/** Derive PRIORITY_LEAGUE_IDS from the fixtures response: for every
 * priority name present, record the league id and log it. */
function derivePriorityIds(fixtures: ApiFootballFixture[]): void {
    PRIORITY_LEAGUE_IDS.length = 0;
    for (const name of PRIORITY_LEAGUE_NAMES) {
        const fixture = fixtures.find((f) => leagueMatchesPriority(f, name));
        if (fixture) {
            PRIORITY_LEAGUE_IDS.push(fixture.league.id);
            console.log(`[AnalysisRun] Priority league found in fixtures: id=${fixture.league.id} name=${fixture.league.name} (${fixture.league.country})`);
        }
    }
}

/** True when the fixture has already kicked off (anything but upcoming
 * statuses), so it is not worth predicting for. */
function isFixtureStarted(fixture: ApiFootballFixture): boolean {
    const status = fixture.status.trim().toUpperCase();
    return !['', 'NS', 'TBD', 'Canc', 'PPD', 'Not Started'].includes(status);
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

interface AnalysisResultRow {
    id: string;
    date: string;
    analysis_type: AnalysisType;
    status: AnalysisStatus;
    free_recommendations: Recommendation[];
    paid_recommendations: Recommendation[];
    vip_recommendations: Recommendation[];
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

function mapAnalysisResult(row: AnalysisResultRow): AnalysisResult {
    return {
        _id: row.id,
        date: row.date,
        analysisType: row.analysis_type,
        status: row.status,
        freeRecommendations: row.free_recommendations ?? [],
        paidRecommendations: row.paid_recommendations ?? [],
        vipRecommendations: row.vip_recommendations ?? [],
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
            if (existing) {
                const aiPrediction = {
                    prediction: `${rec.homeTeam} vs ${rec.awayTeam} — ${rec.suggestedBet}`,
                    confidence: rec.confidence,
                    reasoning: rec.reasoning || [],
                    suggestedBet: rec.suggestedBet,
                    generatedAt: now,
                };
                await db
                    .from('matches')
                    .update({ tier: type, ai_prediction: aiPrediction })
                    .eq('id', existing._id);
                applied++;
            } else {
                console.warn(`[ApproveAnalysis] Match ${rec.matchId} not found`);
            }
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

function buildAnalystPrompt(shortlist: ApiFootballFixture[], predictions: Map<number, ApiFixturePrediction>): string {
    const lines = shortlist.map((fixture) => {
        const prediction = predictions.get(fixture.id);
        const detail = describePrediction(prediction);
        const base = [
            String(fixture.id),
            `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`,
            `| ${fixture.league.name}`,
            `| ${fixture.date}`,
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
    /** Fixtures returned by the fixtures endpoint for the date. */
    fixturesFound: number;
    /** Shortlisted fixtures (priority first), capped at MAX_PREDICTION_CALLS. */
    shortlisted: number;
    predictionsOk: number;
    predictionsFailed: number;
    /** Picks kept by the verifier with confidence ≥ MIN_CONFIDENCE and ranked for insertion. */
    analysed: number;
    published: { vip: number; paid: number; free: number; unassigned: number };
    autoPublished: boolean;
    proposedPicks: ProposedPick[];
    errors: string[];
    verified: boolean;
    removedCount: number;
}

/** Automated daily picks run: fetch the date's fixtures from API-Football,
 * shortlist (priority leagues first), fetch /predictions for each, send the
 * shortlist (with API percentages/advice/form) to the DeepSeek analyst +
 * verifier in ONE batched call, keep picks with confidence ≥ MIN_CONFIDENCE,
 * rank them (VIP_COUNT → vip, PAID_COUNT → paid, FREE_COUNT → free) and
 * create the picks as matches ("af-<fixtureId>"). */
export async function runAutomatedAnalysis(
    db: SupabaseClient,
    input: { date: string },
): Promise<RunAutomatedAnalysisResult> {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) throw new Error('API_FOOTBALL_KEY not configured');
    const errors: string[] = [];

    // 1. Fetch the date's fixtures (1 request; the cached helper).
    const allFixtures = await fetchFixtures(input.date);
    const fixturesFound = allFixtures.length;
    if (fixturesFound === 0) throw new Error(`No fixtures found for ${input.date}`);

    // 1a. Skip women/youth/reserve competitions; skip fixtures that have started.
    const eligible: ApiFootballFixture[] = [];
    for (const fixture of allFixtures) {
        const leagueName = `${fixture.league.name} ${fixture.league.country}`.toLowerCase();
        if (/women|youth|reserve/.test(leagueName) || /\bu\d{2}\b/i.test(leagueName)) {
            console.log(`[AnalysisRun] Skipping (women/youth/reserve): id=${fixture.id} league=${fixture.league.name}`);
            continue;
        }
        if (isFixtureStarted(fixture)) {
            console.log(`[AnalysisRun] Skipping (already started): id=${fixture.id} league=${fixture.league.name} status=${fixture.status}`);
            continue;
        }
        eligible.push(fixture);
    }

    // 2. Shortlist: priority leagues first (ids derived from the fixtures
    //    response and logged), then the rest; cap at MAX_PREDICTION_CALLS.
    derivePriorityIds(allFixtures);
    const prioritySet = new Set(PRIORITY_LEAGUE_IDS);
    const shortlist = [
        ...eligible.filter((f) => prioritySet.has(f.league.id)),
        ...eligible.filter((f) => !prioritySet.has(f.league.id)),
    ].slice(0, MAX_PREDICTION_CALLS);
    const shortlisted = shortlist.length;

    // 3. /predictions?fixture= for each shortlisted fixture (≤ MAX_PREDICTION_CALLS).
    const predictions = new Map<number, ApiFixturePrediction>();
    for (const fixture of shortlist) {
        const result = await fetchFixturePrediction(fixture.id);
        if (result.ok && result.prediction && hasPredictionData(result.prediction)) {
            predictions.set(fixture.id, result.prediction);
        } else {
            errors.push(`predictions ${fixture.id}: ${result.error ?? 'no prediction returned'}`);
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

    // 6. Create the picks in the matches table (skip fixtures that exist).
    const autoPublish = process.env.AUTO_PUBLISH?.toLowerCase() !== 'false';
    const inserted = await insertPicks(db, shortlist, rankedPicks, autoPublish);
    errors.push(...inserted.errors);

    // 7. At most one summary alert per run, only if SEND_SUMMARY_ALERT is "true".
    if (process.env.SEND_SUMMARY_ALERT?.toLowerCase() === 'true') {
        try {
            await createAlert(db, {
                title: 'Daily Picks Ready',
                body: `Analysed ${rankedPicks.length} fixtures — published ${inserted.vip + inserted.paid + inserted.free} picks (VIP ${inserted.vip}, Paid ${inserted.paid}, Free ${inserted.free}).`,
            });
        } catch (alertError) {
            errors.push(`summary alert: ${alertError instanceof Error ? alertError.message : String(alertError)}`);
        }
    }

    const totalRequests = 1 + predictionsOk + 2; // fixtures + predictions + DeepSeek (analyst + verifier)
    console.log(`[AnalysisRun] Done for ${input.date}: fixtures=${fixturesFound} shortlisted=${shortlisted} predictions=${predictionsOk}/${predictionsFailed} picks=${rankedPicks.length} apiRequests=${totalRequests} (limit 40)`);

    return {
        fixturesFound,
        shortlisted,
        predictionsOk,
        predictionsFailed,
        analysed: rankedPicks.length,
        published: {
            vip: inserted.vip,
            paid: inserted.paid,
            free: inserted.free,
            unassigned: autoPublish ? 0 : inserted.unassigned,
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

/** Outcome of insertPicks. */
interface InsertPicksOutcome {
    vip: number;
    paid: number;
    free: number;
    unassigned: number;
    errors: string[];
}

/** Insert ranked picks as matches with external ids "af-<fixtureId>". Picks
 * for fixtures that already exist are skipped, so pressing the button twice
 * creates no duplicates. */
async function insertPicks(
    db: SupabaseClient,
    shortlist: ApiFootballFixture[],
    picks: RankedPick[],
    autoPublish: boolean,
): Promise<InsertPicksOutcome> {
    const byFixtureId = new Map<number, ApiFootballFixture>(shortlist.map((f) => [f.id, f]));
    const outcome: InsertPicksOutcome = { vip: 0, paid: 0, free: 0, unassigned: 0, errors: [] };
    const now = new Date().toISOString();

    for (const pick of picks) {
        const fixture = byFixtureId.get(Number(pick.fixtureId));
        if (!fixture) continue;
        const externalId = `af-${fixture.id}`;
        const existing = await getById(db, externalId);
        if (existing) continue; // never duplicate an existing pick

        const tier: MatchTier = autoPublish ? pick.tier : 'unassigned';
        const details: Record<string, unknown> = {};
        if (fixture.league.logo) details.leagueLogo = fixture.league.logo;
        if (fixture.homeTeam.logo) details.homeTeamLogo = fixture.homeTeam.logo;
        if (fixture.awayTeam.logo) details.awayTeamLogo = fixture.awayTeam.logo;
        if (fixture.league.country) details.country = fixture.league.country;

        const { error } = await db.from('matches').insert({
            external_id: externalId,
            home_team: fixture.homeTeam.name,
            away_team: fixture.awayTeam.name,
            league: fixture.league.name,
            kickoff: fixture.date,
            status: fixture.status,
            score: '0-0',
            match_date: fixture.date.split('T')[0],
            tier,
            trending: null,
            odds: null,
            ai_prediction: {
                prediction: `${fixture.homeTeam.name} vs ${fixture.awayTeam.name} — ${pick.suggestedBet}`,
                confidence: pick.confidence,
                reasoning: pick.reasoning,
                suggestedBet: pick.suggestedBet,
                generatedAt: now,
            },
            is_history: false,
            details: Object.keys(details).length > 0 ? details : null,
        });
        if (error) {
            const message = error.message || 'unknown insert error';
            outcome.errors.push(`insert ${externalId}: ${message}`);
            console.error(`[AnalysisRun] Insert failed for ${externalId}:`, message);
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
