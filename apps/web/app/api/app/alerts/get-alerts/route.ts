import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getAlerts } from '@/lib/db/alerts';

export const dynamic = 'force-dynamic';

// Port of the Convex `alerts.getAlerts` query the mobile app calls.
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('deviceId') ?? undefined;

    const db = createDb();
    if (!db) return NextResponse.json([]);

    try {
        return NextResponse.json(await getAlerts(db, deviceId));
    } catch (error) {
        console.error('[API App Alerts GetAlerts] Error:', error);
        return NextResponse.json({ error: 'Failed to load alerts' }, { status: 500 });
    }
}
