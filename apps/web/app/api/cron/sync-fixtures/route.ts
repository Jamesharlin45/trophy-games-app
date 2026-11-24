import { NextResponse } from 'next/server';
import { isCronRequestAuthorized } from '@/lib/cron-auth';
import { syncFixtures } from '@/lib/sync-fixtures';

export const dynamic = 'force-dynamic';

// GET /api/cron/sync-fixtures — Vercel Cron (05:00 UTC, once a day). The
// Authorization: Bearer header must match the CRON_SECRET; anything else is
// rejected. Runs the same sync as the admin "Refresh fixtures" button.
export async function GET(req: Request) {
    if (!process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
    }
    if (!isCronRequestAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const summary = await syncFixtures();
    return NextResponse.json(summary);
}
