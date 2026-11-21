import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { createToken, getAllTokens, reactivateToken, revokeToken } from '@/lib/db/tokens';
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
        const tokens = await getAllTokens(db);
        return NextResponse.json(tokens);
    } catch (error) {
        console.error('[API] Get tokens failed:', error);
        return NextResponse.json({ error: 'Failed to load tokens' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { deviceId, username, type, matchId, expiresAt } = (await request.json()) as {
            deviceId?: string;
            username?: string;
            type?: TokenType;
            matchId?: string;
            expiresAt?: string;
        };

        if (!deviceId || !type) {
            return NextResponse.json({ error: 'deviceId and type required' }, { status: 400 });
        }

        const token = generateToken(type);

        await createToken(db, { token, deviceId, username, type, matchId, expiresAt });

        return NextResponse.json({ success: true, token });
    } catch (error) {
        console.error('[API] Create token failed:', error);
        return NextResponse.json({ error: 'Failed to create token' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { token } = (await request.json()) as { token?: string };
        if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });
        const changed = await revokeToken(db, token);
        if (changed === 0) {
            return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 });
        }
        return NextResponse.json({ success: true, changed });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[API] Revoke token failed:', error);
        return NextResponse.json({ error: `Failed to revoke token: ${detail}` }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { token } = (await request.json()) as { token?: string };
        if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });
        const changed = await reactivateToken(db, token);
        if (changed === 0) {
            return NextResponse.json({ error: 'Token not found or not revoked' }, { status: 404 });
        }
        return NextResponse.json({ success: true, changed });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[API] Reactivate token failed:', error);
        return NextResponse.json({ error: `Failed to reactivate token: ${detail}` }, { status: 500 });
    }
}
