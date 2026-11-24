import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { getAll } from '@/lib/db/matches';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    triggerDueEmailsIfDue();
    const db = createDb();
    if (!db) return NextResponse.json([]);

    const { searchParams } = new URL(request.url);
    const rawLimit = searchParams.get('limit');

    let limit: number | undefined;
    if (rawLimit !== null && rawLimit !== '') {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) {
            return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
        }
        limit = parsed;
    }

    try {
        return NextResponse.json(await getAll(db, limit, { excludeUnpublishedPicks: true, excludeVoid: true }));
    } catch (error) {
        console.error('[API App Matches All] Error:', error);
        return NextResponse.json({ error: 'Failed to load matches' }, { status: 500 });
    }
}
