import { NextResponse } from 'next/server';
import { readLastSyncedAt, syncFixtures } from '@/lib/sync-fixtures';

export const dynamic = 'force-dynamic';

// GET — Run the fixture sync now (the same function the cron route and the
// admin Matches page's auto-sync use). The page reads matches from the
// database first, so new rows are visible as soon as the sync lands.
export async function GET() {
    const summary = await syncFixtures();
    const lastSyncedAt = await readLastSyncedAt();
    return NextResponse.json({ ...summary, lastSyncedAt });
}
