import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { getActiveSubscription } from '@/lib/db/purchases';

export const dynamic = 'force-dynamic';

// Port of the Convex `purchases.getActiveSubscription` query the mobile app calls.
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('deviceId');
    if (!deviceId) {
        return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
    }

    const db = createDb();
    if (!db) return NextResponse.json(null);

    try {
        return NextResponse.json(await getActiveSubscription(db, deviceId));
    } catch (error) {
        console.error('[API App Purchases GetActiveSubscription] Error:', error);
        return NextResponse.json({ error: 'Failed to load subscription' }, { status: 500 });
    }
}
