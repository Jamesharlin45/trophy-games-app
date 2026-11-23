import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { blockUser, clearFailedAttempts, getAllUsers, unblockUser } from '@/lib/db/users';
import type { TokenType } from '@/lib/db/tokens';

export const dynamic = 'force-dynamic';

export async function GET() {
    const db = createDb();
    if (!db) return NextResponse.json([]);
    try {
        const users = await getAllUsers(db);
        // Show the plan granted to each device (highest tier wins), so the
        // admin Users table has the same context as Tokens and Requests.
        const { data: tokenRows } = await db
            .from('access_tokens')
            .select('device_id, type, is_active, expires_at')
            .eq('is_active', true)
            .limit(2000);
        const { data: purchaseRows } = await db
            .from('purchases')
            .select('device_id, tier, status, expires_at')
            .eq('status', 'verified')
            .limit(2000);
        const plans = new Map<string, TokenType>();
        const addPlan = (deviceId: string, type: TokenType): void => {
            if (plans.get(deviceId) === 'vip') return;
            plans.set(deviceId, type);
        };
        const now = new Date();
        for (const row of (tokenRows ?? []) as Array<{
            device_id: string;
            type: TokenType;
            expires_at: string | null;
        }>) {
            if (!row.expires_at || new Date(row.expires_at) > now) addPlan(row.device_id, row.type);
        }
        for (const row of (purchaseRows ?? []) as Array<{
            device_id: string;
            tier: TokenType;
            expires_at: string | null;
        }>) {
            if (!row.expires_at || new Date(row.expires_at) > now) addPlan(row.device_id, row.tier);
        }
        return NextResponse.json(users.map((user) => ({ ...user, type: plans.get(user.deviceId) })));
    } catch (error) {
        console.error('[API] Get users failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { username, action } = (await request.json()) as { username?: string; action?: string };

        if (!username || !action) {
            return NextResponse.json({ error: 'username and action required' }, { status: 400 });
        }

        if (action === 'block') {
            await blockUser(db, username);
            return NextResponse.json({ success: true });
        }

        if (action === 'unblock') {
            await unblockUser(db, username);
            return NextResponse.json({ success: true });
        }

        if (action === 'clear_attempts') {
            await clearFailedAttempts(db, username);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('[API] Handle user action failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to handle user action' }, { status: 500 });
    }
}
