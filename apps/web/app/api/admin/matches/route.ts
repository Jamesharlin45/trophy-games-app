import { NextResponse } from 'next/server';
import { ConvexHttpClient } from "convex/browser";
import { api } from "@trophy-games/backend";

export const dynamic = 'force-dynamic';

const FALLBACK_CONVEX_URL = 'https://grateful-eel-253.eu-west-1.convex.cloud';

const MATCH_TYPES = ['unassigned', 'free', 'paid', 'vip'] as const;
type MatchType = (typeof MATCH_TYPES)[number];

const MATCH_RESULTS = ['pending', 'win', 'lose', 'draw'] as const;
type MatchResult = (typeof MATCH_RESULTS)[number];

function getConvex() {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL || FALLBACK_CONVEX_URL;
    return new ConvexHttpClient(url);
}

function readString(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : String(value);
}

function readOptionalString(value: unknown): string | undefined {
    const text = readString(value).trim();
    return text || undefined;
}

function readReasoning(value: unknown): string[] | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (Array.isArray(value)) {
        return value.filter((item: unknown): item is string => typeof item === 'string');
    }
    return readString(value).split('\n').map(line => line.trim()).filter(Boolean);
}

// GET — Returns matches from Convex (single source of truth).
export async function GET() {
    const convex = getConvex();

    try {
        const matches = await convex.query(api.matches.getAll, { limit: 1000 });
        return NextResponse.json(matches);
    } catch (error) {
        console.error('[Admin Matches API] Failed to fetch matches:', error);
        return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
    }
}

// POST — Manually create a match from the admin dashboard.
export async function POST(req: Request) {
    const convex = getConvex();

    try {
        const body = await req.json();

        const {
            homeTeam, awayTeam, league, timestamp, status,
            matchType, homeOdds, drawOdds, awayOdds,
            leagueLogo, homeTeamLogo, awayTeamLogo, country, countryFlag,
            isTrending, score, homeScore, awayScore,
            prediction, confidence, suggestedBet, reasoning,
        } = body;

        if (!homeTeam || !awayTeam || !league || !timestamp) {
            return NextResponse.json(
                { error: 'homeTeam, awayTeam, league, and timestamp are required' },
                { status: 400 }
            );
        }

        const matchId = `manual-${Date.now()}`;
        const odds = homeOdds ? {
            home: String(homeOdds),
            away: String(awayOdds || ''),
            draw: drawOdds ? String(drawOdds) : undefined,
        } : undefined;

        // Build an AI prediction only when at least one prediction field has
        // content. The client omits all of them when the form is empty; passing
        // `aiPrediction: null` to Convex is invalid for an optional field.
        const aiReasoning = (readReasoning(reasoning) ?? [])
            .map(line => line.trim())
            .filter(Boolean);
        const aiPredictionText = readString(prediction).trim();
        const aiSuggestedBet = readOptionalString(suggestedBet);
        const confidenceText = readString(confidence).trim();
        const hasAiPrediction = Boolean(
            aiPredictionText || aiReasoning.length || aiSuggestedBet || confidenceText
        );

        let aiPrediction: {
            prediction: string;
            confidence: number;
            reasoning: string[];
            suggestedBet?: string;
            generatedAt: string;
        } | undefined;

        if (hasAiPrediction) {
            // Confidence is a 0–100 percentage; existing data is never converted.
            const numericConfidence = confidenceText ? Number(confidenceText) : 70;
            if (!Number.isFinite(numericConfidence) || numericConfidence < 1 || numericConfidence > 100) {
                return NextResponse.json(
                    { error: 'confidence must be between 1 and 100' },
                    { status: 400 }
                );
            }
            aiPrediction = {
                prediction: aiPredictionText,
                confidence: numericConfidence,
                reasoning: aiReasoning,
                ...(aiSuggestedBet ? { suggestedBet: aiSuggestedBet } : {}),
                generatedAt: new Date().toISOString(),
            };
        }

        await convex.mutation(api.matches.create, {
            match: {
                id: matchId,
                homeTeam: String(homeTeam),
                awayTeam: String(awayTeam),
                league: String(league),
                timestamp: String(timestamp),
                status: String(status || 'Scheduled'),
                score: score || '0-0',
                homeScore: homeScore != null ? Number(homeScore) : undefined,
                awayScore: awayScore != null ? Number(awayScore) : undefined,
                matchType: matchType || 'unassigned',
                leagueLogo: leagueLogo || undefined,
                homeTeamLogo: homeTeamLogo || undefined,
                awayTeamLogo: awayTeamLogo || undefined,
                country: country || undefined,
                countryFlag: countryFlag || undefined,
                isTrending: isTrending === true,
                odds,
                aiPrediction,
            },
        });

        return NextResponse.json({ success: true, matchId });
    } catch (error) {
        console.error('[Admin Matches API] Failed to create match:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Failed to create match',
        }, { status: 500 });
    }
}

interface MatchUpdateFields {
    league?: string;
    leagueLogo?: string;
    homeTeam?: string;
    homeTeamLogo?: string;
    awayTeam?: string;
    awayTeamLogo?: string;
    country?: string;
    countryFlag?: string;
    timestamp?: string;
    status?: string;
    score?: string;
    homeScore?: number | null;
    awayScore?: number | null;
    matchType?: MatchType;
    isTrending?: boolean;
    odds?: { home: string; away: string; draw?: string } | null;
    aiPrediction?: {
        prediction: string;
        confidence: number;
        reasoning: string[];
        suggestedBet?: string;
        generatedAt: string;
    };
    result?: MatchResult;
    isHistory?: boolean;
    matchDate?: string;
}

// PUT — Edit an existing match from the admin dashboard. Every field the form
// can change is forwarded to the validated Convex `matches.update` mutation.
// Only keys present in the payload are sent, so a partial edit leaves the
// other stored fields (including every aiPrediction field) intact.
export async function PUT(req: Request) {
    const convex = getConvex();

    try {
        const body: unknown = await req.json();
        if (typeof body !== 'object' || body === null) {
            return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
        }
        const payload = body as Record<string, unknown>;
        const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(payload, key);

        const matchId = readString(payload.matchId).trim();
        if (!matchId) {
            return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
        }

        const updates: MatchUpdateFields = {};

        // Non-empty core fields. Validated when supplied so that omitting one
        // keeps this a genuine partial edit.
        for (const key of ['homeTeam', 'awayTeam', 'league', 'timestamp', 'status', 'score'] as const) {
            if (!has(key)) continue;
            const value = readString(payload[key]).trim();
            if (!value) {
                return NextResponse.json({ error: `${key} cannot be empty` }, { status: 400 });
            }
            updates[key] = value;
        }

        // Optional text fields — an empty value clears the stored field.
        for (const key of ['leagueLogo', 'homeTeamLogo', 'awayTeamLogo', 'country', 'countryFlag'] as const) {
            if (has(key)) updates[key] = readString(payload[key]).trim();
        }

        if (has('matchType')) {
            const value = readString(payload.matchType);
            updates.matchType = MATCH_TYPES.find(type => type === value) ?? 'unassigned';
        }
        if (has('result')) {
            const value = readString(payload.result);
            updates.result = MATCH_RESULTS.find(option => option === value) ?? 'pending';
        }
        if (has('isTrending')) updates.isTrending = payload.isTrending === true;
        if (has('isHistory')) updates.isHistory = payload.isHistory === true;

        for (const key of ['homeScore', 'awayScore'] as const) {
            if (!has(key)) continue;
            const value = payload[key];
            if (value === null || value === '') {
                updates[key] = null;
                continue;
            }
            const number = Number(value);
            if (!Number.isFinite(number)) {
                return NextResponse.json({ error: `${key} must be a number` }, { status: 400 });
            }
            updates[key] = number;
        }
        if (typeof updates.homeScore === 'number' && typeof updates.awayScore === 'number') {
            updates.score = `${updates.homeScore}-${updates.awayScore}`;
        }

        if (has('homeOdds') || has('drawOdds') || has('awayOdds')) {
            const home = readString(payload.homeOdds).trim();
            const draw = readString(payload.drawOdds).trim();
            const away = readString(payload.awayOdds).trim();
            updates.odds = (home || draw || away)
                ? { home, away, ...(draw ? { draw } : {}) }
                : null;
        }

        const aiKeys = ['prediction', 'confidence', 'suggestedBet', 'reasoning', 'generatedAt'] as const;
        if (aiKeys.some(has)) {
            // Merge with what is stored so a partial edit never wipes AI
            // fields the caller didn't include.
            const existing = await convex.query(api.matches.getById, { matchId });
            const prior = existing?.aiPrediction;

            const prediction = has('prediction')
                ? readString(payload.prediction).trim()
                : prior?.prediction ?? '';
            const confidenceRaw = has('confidence') ? payload.confidence : prior?.confidence;
            const confidence = confidenceRaw === undefined || confidenceRaw === null || confidenceRaw === ''
                ? 70
                : Number(confidenceRaw);
            if (!Number.isFinite(confidence) || confidence < 1 || confidence > 100) {
                return NextResponse.json(
                    { error: 'confidence must be between 1 and 100' },
                    { status: 400 }
                );
            }
            const reasoning = readReasoning(has('reasoning') ? payload.reasoning : prior?.reasoning) ?? [];
            const suggestedBet = has('suggestedBet')
                ? readOptionalString(payload.suggestedBet)
                : prior?.suggestedBet;
            const generatedAt = has('generatedAt')
                ? readOptionalString(payload.generatedAt)
                : prior?.generatedAt;

            // When every AI field is empty, omit aiPrediction rather than
            // sending null (Convex rejects null for v.optional fields). An
            // omitted key also guarantees an edit never erases stored fields
            // the user did not touch.
            const hasAiContent = Boolean(
                prediction || reasoning.length || suggestedBet ||
                (has('confidence') && readString(payload.confidence).trim())
            );
            if (hasAiContent) {
                updates.aiPrediction = {
                    prediction,
                    confidence,
                    reasoning,
                    ...(suggestedBet ? { suggestedBet } : {}),
                    generatedAt: generatedAt || new Date().toISOString(),
                };
            }
        }

        await convex.mutation(api.matches.update, { matchId, updates });
        return NextResponse.json({ success: true, matchId });
    } catch (error) {
        console.error('[Admin Matches API] Failed to update match:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Failed to update match',
        }, { status: 500 });
    }
}

// DELETE — Delete a manual match.
export async function DELETE(req: Request) {
    const convex = getConvex();

    try {
        const { searchParams } = new URL(req.url);
        const matchId = searchParams.get('id');

        if (!matchId) {
            return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }

        await convex.mutation(api.matches.deleteMatch, { matchId });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Admin Matches API] Failed to delete match:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Failed to delete match',
        }, { status: 500 });
    }
}
