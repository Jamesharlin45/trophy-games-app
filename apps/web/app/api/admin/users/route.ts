import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { blockUser, clearFailedAttempts, getAllUsers, unblockUser } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

export async function GET() {
    const db = createDb();
    if (!db) return NextResponse.json([]);
    try {
        const users = await getAllUsers(db);
        return NextResponse.json(users);
    } catch (error) {
        console.error('[API] Get users failed:', error);
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
        console.error('[API] Handle user action failed:', error);
        return NextResponse.json({ error: 'Failed to handle user action' }, { status: 500 });
    }
}
