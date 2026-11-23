import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { syncResults } from '@/lib/sync-results';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET /api/admin/sync-results — the "Refresh results" button on the admin
// Matches page. Forces the run (the opportunistic in-app trigger is throttled
// to once per 3 hours; admins expect an immediate refresh).
export async function GET() {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

    try {
        const result = await syncResults(db, { force: true });
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Admin Sync Results] Failed:', error);
        const message = error instanceof Error ? error.message : 'Failed to sync results';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
