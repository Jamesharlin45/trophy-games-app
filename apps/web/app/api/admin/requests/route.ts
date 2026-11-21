import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import {
    approveMembershipRequest,
    extendMembershipRequestToken,
    getAllRequests,
    rejectMembershipRequest,
    revokeMembershipRequest,
} from '@/lib/db/tokens';
import type { TokenType } from '@/lib/db/tokens';

export const dynamic = 'force-dynamic';

function generateToken(type: string): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const prefix = type === 'vip' ? 'VIP' : 'PAD';
    let token = prefix + '-';
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            token += chars[Math.floor(Math.random() * chars.length)];
        }
        if (i < 3) token += '-';
    }
    return token;
}

export async function GET() {
    const db = createDb();
    if (!db) return NextResponse.json([]);
    try {
        const requests = await getAllRequests(db);
        return NextResponse.json(requests);
    } catch (error) {
        console.error('[API] Get requests failed:', error);
        return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { requestId, action, matchId, expiresAt, days } = (await request.json()) as {
            requestId?: string;
            action?: string;
            matchId?: string;
            expiresAt?: string;
            days?: 7 | 30;
        };

        if (!requestId || !action) {
            return NextResponse.json({ error: 'requestId and action required' }, { status: 400 });
        }

        if (action === 'approve') {
            // Get the request to know the type
            const allRequests = await getAllRequests(db);
            const req = allRequests.find((r) => r._id === requestId);
            if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

            const token = generateToken(req.type);
            await approveMembershipRequest(db, { requestId, token, matchId, expiresAt });
            return NextResponse.json({ success: true, token });
        }

        if (action === 'reject') {
            await rejectMembershipRequest(db, { requestId });
            return NextResponse.json({ success: true });
        }

        if (action === 'revoke') {
            const result = await revokeMembershipRequest(db, requestId);
            if (!result.success) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            return NextResponse.json({ success: true });
        }

        if (action === 'extend') {
            if (days !== 7 && days !== 30) {
                return NextResponse.json({ error: 'days must be 7 or 30' }, { status: 400 });
            }
            const result = await extendMembershipRequestToken(db, requestId, days);
            if (!result.success) return NextResponse.json({ error: 'Request has no issued token' }, { status: 400 });
            return NextResponse.json({ success: true, expiresAt: result.expiresAt });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('[API] Handle request failed:', error);
        return NextResponse.json({ error: 'Failed to handle request' }, { status: 500 });
    }
}
