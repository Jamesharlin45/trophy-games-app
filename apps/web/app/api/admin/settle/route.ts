import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { settleMatches } from '@/lib/settle';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/admin/settle — "Settle results now" button on the Analysis page.
// The route lives under /api/admin/* so proxy.ts protects it with Basic Auth.
export async function POST() {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const result = await settleMatches(db);
        return NextResponse.json(result);
    } catch (error) {
        console.error('[Admin Settle API] Settlement failed:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Settlement failed' },
            { status: 500 },
        );
    }
}
