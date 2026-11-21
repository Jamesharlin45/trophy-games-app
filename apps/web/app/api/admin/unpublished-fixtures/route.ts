import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getUnpublishedFixtures } from '@/lib/db/matches';

export const dynamic = 'force-dynamic';

// GET — Stored unpublished fixtures for a date: rows with an external id
// starting 'af-' and tier 'unassigned' (the set the mobile app excludes).
export async function GET(req: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    if (!date) {
        return NextResponse.json({ error: 'date is required' }, { status: 400 });
    }

    try {
        return NextResponse.json(await getUnpublishedFixtures(db, date));
    } catch (error) {
        console.error('[Admin Unpublished Fixtures API] Failed to fetch fixtures:', error);
        return NextResponse.json({ error: 'Failed to load unpublished fixtures' }, { status: 500 });
    }
}
