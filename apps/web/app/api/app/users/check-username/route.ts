import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { checkUsername } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    if (username === null) {
        return NextResponse.json({ error: 'username is required' }, { status: 400 });
    }

    const db = createDb();
    if (!db) return NextResponse.json({ available: false });

    try {
        return NextResponse.json(await checkUsername(db, username));
    } catch (error) {
        console.error('[API App Users CheckUsername] Error:', error);
        return NextResponse.json({ error: 'Failed to check username' }, { status: 500 });
    }
}
