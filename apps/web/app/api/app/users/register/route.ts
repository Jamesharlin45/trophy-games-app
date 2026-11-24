import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { registerUser } from '@/lib/db/users';
import { isValidDeviceId } from '@/lib/device-id';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    triggerDueEmailsIfDue();
    const db = createDb();
    if (!db) {
        return NextResponse.json({ success: false, reason: 'Supabase not configured' }, { status: 500 });
    }

    let body: { username?: unknown; deviceId?: unknown } | null;
    try {
        body = (await request.json()) as { username?: unknown; deviceId?: unknown } | null;
    } catch (error) {
        console.error('[API App Users Register] Invalid JSON body:', error);
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { username, deviceId } = body ?? {};
    if (typeof username !== 'string' || typeof deviceId !== 'string') {
        return NextResponse.json({ error: 'username and deviceId are required' }, { status: 400 });
    }
    if (!isValidDeviceId(deviceId)) {
        return NextResponse.json({ success: false, reason: 'Invalid device id' }, { status: 400 });
    }

    try {
        return NextResponse.json(await registerUser(db, username, deviceId));
    } catch (error) {
        console.error('[API App Users Register] Error:', error);
        return NextResponse.json({ error: 'Failed to register user' }, { status: 500 });
    }
}
