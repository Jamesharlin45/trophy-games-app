import type { SupabaseClient } from '@supabase/supabase-js';
import type { MatchData } from '@trophy-games/shared';
import { getById, getByDate as getMatchesByDate, matchDetail } from './matches';
import type { DbMatch, MatchTier } from './types';

// --- DeepSeek config (ports packages/backend/convex/analysis.ts) ---

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

const TRENDING_LEAGUES = [
    'English Premier League', 'Championship', 'FA Cup',
    'La Liga', 'Copa del Rey',
    'Serie A', 'Coppa Italia',
    'Bundesliga', 'DFB-Pokal',
    'Ligue 1',
    'Champions League', 'Europa League', 'Conference League',
    'Eredivisie', 'Primeira Liga', 'Belgian Pro League',
    'Scottish Premiership', 'Super Lig',
    'Brazil Serie A', 'Argentina Primera Division',
    'MLS', 'Saudi Pro League',
    'FIFA Club World Cup', 'World Cup',
    'Africa Cup of Nations', 'Copa America', 'Euro Championship',
];

const SYSTEM_PROMPT_ANALYST = `You are an elite football betting analyst with 15+ years of experience. Your expertise covers statistical modeling, team form analysis, head-to-head data, tactical matchups, and value betting principles.

Analyze matches objectively using data. For each recommended match provide:
1. matchId (exact string from input)
2. homeTeam, awayTeam, league, timestamp
3. recommendedType: "free", "paid", or "vip"
4. confidence: 0-100 (data-driven, not arbitrary)
5. reasoning: 2-4 specific analytical points as array of strings
6. suggestedBet: specific bet suggestion (e.g., "Home Win", "Over 2.5 Goals", "BTTS Yes")
7. keyStats: 2-3 supporting statistics as array of strings
8. riskLevel: "low", "medium", or "high"

TIER GUIDELINES:
- FREE (20 matches): Confidence 75-100%, low-medium risk, clear statistical edge. Focus on favorites with strong form.
- PAID (20 matches): Confidence 60-85%, medium risk, value odds 2.0+. Strong indicators but not obvious.
- VIP (20 matches): Confidence 50-75%, medium-high risk, high odds 2.5+. Contrarian picks with data backing.

Each of the 3 categories MUST have exactly 20 distinct matches. No overlap between categories.
Return ONLY valid JSON.`;

const SYSTEM_PROMPT_VERIFIER = `You are a senior betting verification analyst. Your job is to double-check recommendations and remove any that lack sufficient evidence or have inflated confidence scores.

Be conservative. Remove matches where:
- Confidence score doesn't match the reasoning quality
- Risk level contradicts the tier assignment
- Key stats don't actually support the recommendation
- The match has insufficient data for analysis

Return ONLY valid JSON with verified recommendations and removal reasons.`;

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

/** Port of Convex api.analysis.saveResult — upsert the result row for a
 * date: patch the existing row or insert a new one (status 'verified'). */
export async function saveResult(
    db: SupabaseClient,
    input: {
        date: string;
        analysisType: AnalysisType;
        freeRecommendations: Recommendation[];
        paidRecommendations: Recommendation[];
        vipRecommendations: Recommendation[];
        verificationNotes?: string[];
        removedMatches?: RemovedMatch[];
        confidenceAdjustment?: number;
        model: string;
        generatedAt: string;
    },
): Promise<string> {
    const { data } = await db
        .from('analysis_results')
        .select('id')
        .eq('date', input.date)
        .limit(1);

    if (data && data.length > 0) {
        await db
            .from('analysis_results')
            .update({
                status: 'verified',
                free_recommendations: input.freeRecommendations,
                paid_recommendations: input.paidRecommendations,
                vip_recommendations: input.vipRecommendations,
                verification_notes: input.verificationNotes ?? null,
                removed_matches: input.removedMatches ?? null,
                confidence_adjustment: input.confidenceAdjustment ?? null,
                model: input.model,
                generated_at: input.generatedAt,
                updated_at: new Date().toISOString(),
            })
            .eq('id', data[0].id);
        return data[0].id;
    }

    const { data: inserted, error } = await db
        .from('analysis_results')
        .insert({
            date: input.date,
            analysis_type: input.analysisType,
            status: 'verified',
            free_recommendations: input.freeRecommendations,
            paid_recommendations: input.paidRecommendations,
            vip_recommendations: input.vipRecommendations,
            verification_notes: input.verificationNotes ?? null,
            removed_matches: input.removedMatches ?? null,
            confidence_adjustment: input.confidenceAdjustment ?? null,
            model: input.model,
            generated_at: input.generatedAt,
            created_at: input.generatedAt,
            updated_at: input.generatedAt,
        })
        .select('id')
        .single();
    if (error || !inserted) throw new Error(error?.message ?? 'Failed to save analysis result');
    return inserted.id;
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

// --- DeepSeek port (api.analysis.runAnalysis) ---

interface DeepSeekResponse {
    choices?: Array<{ message?: { content?: string } }>;
}

interface DeepSeekJson {
    freeRecommendations?: Recommendation[];
    paidRecommendations?: Recommendation[];
    vipRecommendations?: Recommendation[];
    verificationNotes?: string[];
    removedMatches?: RemovedMatch[];
    confidenceAdjustment?: number;
    verified?: boolean;
}

function formatMatchesForPrompt(matches: DbMatch[]): string {
    return matches
        .map((m, i) => {
            const potentials = matchDetail<MatchData['potentials']>(m, 'potentials');
            const homeForm = matchDetail<string>(m, 'homeForm');
            const awayForm = matchDetail<string>(m, 'awayForm');
            const potentialsText = potentials
                ? potentials.map((p) => `${p.label}=${p.percent ?? p.value}`).join(', ')
                : '';
            return `Match ${i + 1}: ID=${m.id} | ${m.homeTeam} vs ${m.awayTeam} | ${m.league} | ${m.timestamp} | Odds: H=${m.odds?.home || "N/A"} D=${m.odds?.draw || "N/A"} A=${m.odds?.away || "N/A"} | Score: ${m.homeScore ?? "-"}-${m.awayScore ?? "-"} | Form: H=${homeForm || "N/A"} A=${awayForm || "N/A"} | Potentials: ${potentialsText || "N/A"}`;
        })
        .join('\n');
}

async function callDeepSeek(systemPrompt: string, userPrompt: string, apiKey: string): Promise<DeepSeekJson> {
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

    return JSON.parse(content) as DeepSeekJson;
}

export interface RunAnalysisResult {
    resultId: string;
    freeCount: number;
    paidCount: number;
    vipCount: number;
    removedCount: number;
    verified: boolean;
}

/** Port of Convex api.analysis.runAnalysis — run DeepSeek on matches for a
 * date, verify recommendations, then save the result row. */
export async function runAnalysis(
    db: SupabaseClient,
    input: { date: string; analysisType: AnalysisType },
): Promise<RunAnalysisResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

    // 1. Fetch matches for the date
    const matches = await getMatchesByDate(db, input.date);
    if (!matches || matches.length === 0) {
        throw new Error(`No matches found for ${input.date}`);
    }

    // 2. Filter to trending leagues and scheduled/incomplete matches
    const eligible = matches.filter((m) => {
        const league = m.league?.toLowerCase();
        const isTrendingLeague =
            league !== undefined &&
            TRENDING_LEAGUES.some((tl) => league.includes(tl) || tl.includes(league));
        const isUpcoming = m.status === 'Scheduled' || m.status === 'incomplete' || m.status === 'NS';
        return isTrendingLeague && isUpcoming;
    });

    if (eligible.length < 60) {
        console.warn(`[Analysis] Only ${eligible.length} eligible matches found (need 60). Using all available.`);
    }

    const pool = eligible.length > 0 ? eligible : matches;

    // 3. Call DeepSeek Analyst
    const analysisPrompt = `Analyze ${pool.length} football matches for ${input.date}. Select TOP 20 for each tier (FREE, PAID, VIP). Each tier gets 20 distinct matches.

${formatMatchesForPrompt(pool)}

Return JSON:
{
  "freeRecommendations": [{matchId, homeTeam, awayTeam, league, timestamp, recommendedType:"free", confidence, reasoning:[], suggestedBet, keyStats:[], riskLevel}],
  "paidRecommendations": [...],
  "vipRecommendations": [...]
}`;

    const analysisResult = await callDeepSeek(SYSTEM_PROMPT_ANALYST, analysisPrompt, apiKey);

    // 4. Call DeepSeek Verifier
    const allRecs = [
        ...(analysisResult.freeRecommendations || []),
        ...(analysisResult.paidRecommendations || []),
        ...(analysisResult.vipRecommendations || []),
    ];

    const verifyPrompt = `Verify these ${allRecs.length} betting recommendations:

${allRecs.map((r, i) => `${i + 1}. ${r.homeTeam} vs ${r.awayTeam} | ${r.recommendedType} | ${r.confidence}% | ${r.suggestedBet} | ${r.riskLevel} | Reasoning: ${(r.reasoning || []).join("; ")}`).join('\n')}

Return JSON:
{
  "verified": true/false,
  "removedMatches": [{matchId, reason}],
  "adjustedRecommendations": [{matchId, homeTeam, awayTeam, league, timestamp, recommendedType, confidence, reasoning, suggestedBet, keyStats, riskLevel}],
  "verificationNotes": ["..."],
  "confidenceAdjustment": number
}`;

    const verifyResult = await callDeepSeek(SYSTEM_PROMPT_VERIFIER, verifyPrompt, apiKey);

    // 5. Save results
    const now = new Date().toISOString();
    const resultId = await saveResult(db, {
        date: input.date,
        analysisType: input.analysisType,
        freeRecommendations: analysisResult.freeRecommendations || [],
        paidRecommendations: analysisResult.paidRecommendations || [],
        vipRecommendations: analysisResult.vipRecommendations || [],
        verificationNotes: verifyResult.verificationNotes || [],
        removedMatches: verifyResult.removedMatches || [],
        confidenceAdjustment: verifyResult.confidenceAdjustment || 0,
        model: DEEPSEEK_MODEL,
        generatedAt: now,
    });

    return {
        resultId,
        freeCount: (analysisResult.freeRecommendations || []).length,
        paidCount: (analysisResult.paidRecommendations || []).length,
        vipCount: (analysisResult.vipRecommendations || []).length,
        removedCount: (verifyResult.removedMatches || []).length,
        verified: verifyResult.verified ?? false,
    };
}

/** Analysis tier applied by approveAnalysis (type tag written to matches). */
export type AnalysisTier = MatchTier;
