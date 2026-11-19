import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getAll } from '@/lib/db/matches';
import { saveAIPrediction } from '@/lib/db/matches';

export const dynamic = 'force-dynamic';

// GET /api/admin/predictions — List matches with their current predictions
export async function GET() {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    try {
        const matches = await getAll(db, 1000);
        return NextResponse.json(matches);
    } catch (error) {
        console.error('[Admin Predictions API] GET failed:', error);
        return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 });
    }
}

// POST /api/admin/predictions — Save a manual prediction for a match
export async function POST(req: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    try {
        const body = (await req.json()) as {
            matchId?: string;
            aiPrediction?: {
                prediction?: string;
                confidence?: number;
                reasoning?: string[];
                suggestedBet?: string;
            };
        };
        const matchId = String(body.matchId ?? '');
        const aiPrediction = body.aiPrediction;

        if (!matchId || !aiPrediction?.prediction) {
            return NextResponse.json({ error: 'matchId and aiPrediction.prediction are required' }, { status: 400 });
        }

        const confidence = Number(aiPrediction.confidence);
        if (isNaN(confidence) || confidence < 1 || confidence > 100) {
            return NextResponse.json({ error: 'confidence must be a number between 1 and 100' }, { status: 400 });
        }

        await saveAIPrediction(db, matchId, {
            prediction: String(aiPrediction.prediction).trim(),
            confidence,
            reasoning: Array.isArray(aiPrediction.reasoning) ? aiPrediction.reasoning : [],
            suggestedBet: aiPrediction.suggestedBet ? String(aiPrediction.suggestedBet).trim() : undefined,
        });


        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Admin Predictions API] POST failed:', error);
        return NextResponse.json({
            error: 'Failed to save prediction',
            details: error instanceof Error ? error.message : 'Unknown error',
        }, { status: 500 });
    }
}
