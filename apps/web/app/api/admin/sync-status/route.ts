import { NextResponse } from 'next/server';
import { readLastSyncedAt } from '@/lib/sync-fixtures';

export const dynamic = 'force-dynamic';

// GET — When was the last fixture sync? The admin Matches page uses this to
// decide whether to run syncFixtures in the background when it opens.
export async function GET() {
    const lastSyncedAt = await readLastSyncedAt();
    return NextResponse.json({ lastSyncedAt });
}
