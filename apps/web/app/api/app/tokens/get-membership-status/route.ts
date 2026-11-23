import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { getMembershipStatus, type TokenType } from '@/lib/db/tokens';

export const dynamic = 'force-dynamic';

function isTokenType(value: string | null): value is TokenType {
    return value === 'vip' || value === 'paid';
}

// Port of the Convex `tokens.getMembershipStatus` query the mobile app calls.
export async function GET(request: Request) {
    triggerDueEmailsIfDue();
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('deviceId');
    const type = searchParams.get('type');
    const username = searchParams.get('username');

    if (!deviceId || !isTokenType(type)) {
        return NextResponse.json(
            { error: 'deviceId is required and type must be one of: vip, paid' },
            { status: 400 },
        );
    }

    const db = createDb();
    if (!db) return NextResponse.json(null);

    try {
        return NextResponse.json(
            await getMembershipStatus(db, { deviceId, username: username ?? undefined, type }),
        );
    } catch (error) {
        console.error('[API App Tokens GetMembershipStatus] Error:', error);
        return NextResponse.json({ error: 'Failed to get membership status' }, { status: 500 });
    }
}
