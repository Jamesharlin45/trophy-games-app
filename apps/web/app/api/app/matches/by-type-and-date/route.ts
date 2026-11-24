import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { getByTypeAndDate } from '@/lib/db/matches';
import type { MatchTier } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

const MATCH_TIERS: readonly MatchTier[] = ['free', 'paid', 'vip', 'unassigned'];

function isMatchTier(value: string | null): value is MatchTier {
    return value !== null && MATCH_TIERS.some((tier) => tier === value);
}

export async function GET(request: Request) {
    triggerDueEmailsIfDue();
    const { searchParams } = new URL(request.url);
    const matchType = searchParams.get('matchType');
    const date = searchParams.get('date');

    if (!isMatchTier(matchType)) {
        return NextResponse.json(
            { error: 'matchType must be one of: free, paid, vip, unassigned' },
            { status: 400 },
        );
    }
    if (!date) {
        return NextResponse.json({ error: 'date is required' }, { status: 400 });
    }

    const rawLimit = searchParams.get('limit');
    let limit: number | undefined;
    if (rawLimit !== null && rawLimit !== '') {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) {
            return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
        }
        limit = parsed;
    }

    const db = createDb();
    if (!db) return NextResponse.json([]);

    try {
        return NextResponse.json(await getByTypeAndDate(db, matchType, date, limit, {
            excludeUnpublishedPicks: matchType === 'unassigned',
            excludeVoid: true,
        }));
    } catch (error) {
        console.error('[API App Matches ByTypeAndDate] Error:', error);
        return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
    }
}
