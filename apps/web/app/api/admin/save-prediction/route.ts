import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { sanitizeProxyMatch, saveAIPrediction } from '@/lib/db/matches';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const { matchId, aiPrediction, match } = (await req.json()) as {
            matchId?: string;
            aiPrediction?: {
                prediction?: string;
                confidence?: number;
                reasoning?: string[];
                suggestedBet?: string;
            };
            match?: Record<string, unknown>;
        };

        if (!matchId || !aiPrediction) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Upsert the proxy match if needed, then store the prediction.
        await saveAIPrediction(db, matchId, {
            prediction: String(aiPrediction.prediction ?? ''),
            confidence: Number(aiPrediction.confidence),
            reasoning: Array.isArray(aiPrediction.reasoning) ? aiPrediction.reasoning : [],
            suggestedBet: aiPrediction.suggestedBet,
        }, match ? sanitizeProxyMatch(match) : undefined);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Save Prediction API] Error:', error);
        return NextResponse.json({
            error: 'Failed to save prediction',
            details: error instanceof Error ? error.message : 'Unknown error',
        }, { status: 500 });
    }
}
