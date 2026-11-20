import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { publishProposedPicks, type PickTier } from '@/lib/db/analysis';

// POST /api/analysis/publish - Publish proposed picks (unassigned matches → tier)
export async function POST(req: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const body = (await req.json()) as { picks?: Array<Record<string, unknown>> };
        const picks: Array<{ externalId: string; tier: PickTier }> = [];
        for (const pick of body.picks ?? []) {
            const externalId = typeof pick.externalId === 'string' ? pick.externalId : '';
            const tier = pick.tier;
            if (externalId === '' || (tier !== 'vip' && tier !== 'paid' && tier !== 'free')) continue;
            picks.push({ externalId, tier });
        }
        if (picks.length === 0) {
            return NextResponse.json({ error: 'Missing picks' }, { status: 400 });
        }

        const result = await publishProposedPicks(db, picks);
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Analysis API] Publish failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Publish failed' }, { status: 500 });
    }
}
