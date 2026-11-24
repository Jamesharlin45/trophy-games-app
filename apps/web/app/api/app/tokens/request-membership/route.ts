import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { requestMembership, type TokenType } from '@/lib/db/tokens';
import { isValidDeviceId } from '@/lib/device-id';

export const dynamic = 'force-dynamic';

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function isTokenType(value: string | undefined): value is TokenType {
    return value === 'vip' || value === 'paid';
}

// Port of the Convex `tokens.requestMembership` mutation the mobile app calls.
export async function POST(request: Request) {
    triggerDueEmailsIfDue();
    const db = createDb();
    if (!db) {
        return NextResponse.json({ success: false, reason: 'Supabase not configured' }, { status: 500 });
    }

    let body: Record<string, unknown> | null = null;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch (error) {
        console.error('[API App Tokens RequestMembership] Invalid JSON body:', error);
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const deviceId = readString(body?.deviceId);
    const username = readString(body?.username);
    const type = readString(body?.type);
    const email = readString(body?.email);
    if (!deviceId || !isTokenType(type) || !isValidDeviceId(deviceId)) {
        return NextResponse.json(
            { error: 'valid deviceId and type vip/paid are required' },
            { status: 400 },
        );
    }
    if (!email) {
        return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    try {
        return NextResponse.json(await requestMembership(db, { deviceId, username, type, email }));
    } catch (error) {
        console.error('[API App Tokens RequestMembership] Error:', error);
        return NextResponse.json({ error: 'Failed to send request' }, { status: 500 });
    }
}
