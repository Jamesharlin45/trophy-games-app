import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { markRead } from '@/lib/db/alerts';

export const dynamic = 'force-dynamic';

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

// Port of the Convex `alerts.markRead` mutation the mobile app calls.
export async function POST(request: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ success: false, reason: 'Supabase not configured' }, { status: 500 });
    }

    let body: Record<string, unknown> | null = null;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch (error) {
        console.error('[API App Alerts MarkRead] Invalid JSON body:', error);
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const alertId = readString(body?.alertId);
    const deviceId = readString(body?.deviceId);
    if (!alertId || !deviceId) {
        return NextResponse.json({ error: 'alertId and deviceId are required' }, { status: 400 });
    }

    try {
        await markRead(db, alertId, deviceId);
        return NextResponse.json(null);
    } catch (error) {
        console.error('[API App Alerts MarkRead] Error:', error);
        return NextResponse.json({ error: 'Failed to mark alert read' }, { status: 500 });
    }
}
