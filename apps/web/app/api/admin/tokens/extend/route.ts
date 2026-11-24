import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { extendToken } from '@/lib/db/tokens';

export const dynamic = 'force-dynamic';

// POST /api/admin/tokens/extend — extend a granted token's expiry by +7 or
// +30 days (Tokens page "Extend +7d" / "Extend +30d").
export async function POST(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { token, days } = (await request.json()) as { token?: string; days?: 7 | 30 };
        if (!token) {
            return NextResponse.json({ error: 'token is required' }, { status: 400 });
        }
        if (days !== 7 && days !== 30) {
            return NextResponse.json({ error: 'days must be 7 or 30' }, { status: 400 });
        }
        const result = await extendToken(db, token, days);
        if (!result.success) return NextResponse.json({ error: 'Token not found' }, { status: 404 });
        return NextResponse.json({ success: true, expiresAt: result.expiresAt });
    } catch (error) {
        console.error('[API] Extend token failed:', error);
        return NextResponse.json({ error: 'Failed to extend token' }, { status: 500 });
    }
}
