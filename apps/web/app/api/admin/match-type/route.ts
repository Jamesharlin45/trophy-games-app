import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { updateMatchType, sanitizeProxyMatch } from '@/lib/db/matches';
import type { MatchTier, ProxyMatchInput } from '@/lib/db/types';

// POST - Tag a match as free/paid/vip. The match is upserted when it originates
// from the FootyStats proxy, so the mobile paid/vip tabs pick it up.
export async function POST(req: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    try {
        const { matchId, matchType, match } = (await req.json()) as {
            matchId?: string;
            matchType?: string;
            match?: Record<string, unknown>;
        };

        if (!matchId || !matchType) {
            return NextResponse.json({ error: 'Missing required fields: matchId, matchType' }, { status: 400 });
        }

        const tier = matchType as MatchTier;
        await updateMatchType(db, matchId, tier, match ? sanitizeProxyMatch(match) : undefined);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[Match Type API] Error:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'Failed to update match type',
        }, { status: 500 });
    }
}
