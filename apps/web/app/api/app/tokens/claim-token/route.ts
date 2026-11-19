import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { claimToken } from '@/lib/db/tokens';

export const dynamic = 'force-dynamic';

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

// Port of the Convex `tokens.claimToken` mutation the mobile app calls.
export async function POST(request: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ success: false, reason: 'Supabase not configured' }, { status: 500 });
    }

    let body: Record<string, unknown> | null = null;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch (error) {
        console.error('[API App Tokens ClaimToken] Invalid JSON body:', error);
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const token = readString(body?.token);
    const deviceId = readString(body?.deviceId);
    const username = readString(body?.username);
    if (!token || !deviceId) {
        return NextResponse.json({ error: 'token and deviceId are required' }, { status: 400 });
    }

    try {
        return NextResponse.json(await claimToken(db, { token, deviceId, username }));
    } catch (error) {
        console.error('[API App Tokens ClaimToken] Error:', error);
        return NextResponse.json({ error: 'Failed to verify token' }, { status: 500 });
    }
}
