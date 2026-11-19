import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { registerPushToken } from '@/lib/db/devices';

export const dynamic = 'force-dynamic';

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

// Port of the Convex `devices.registerPushToken` mutation the mobile app calls.
export async function POST(request: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ success: false, reason: 'Supabase not configured' }, { status: 500 });
    }

    let body: Record<string, unknown> | null = null;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch (error) {
        console.error('[API App Devices RegisterPushToken] Invalid JSON body:', error);
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const deviceId = readString(body?.deviceId);
    const pushToken = readString(body?.pushToken);
    if (!deviceId || !pushToken) {
        return NextResponse.json({ error: 'deviceId and pushToken are required' }, { status: 400 });
    }

    try {
        await registerPushToken(db, { deviceId, pushToken });
        return NextResponse.json(null);
    } catch (error) {
        console.error('[API App Devices RegisterPushToken] Error:', error);
        return NextResponse.json({ error: 'Failed to register push token' }, { status: 500 });
    }
}
