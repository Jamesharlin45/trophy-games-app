import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { getUserByDevice } from '@/lib/db/users';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    triggerDueEmailsIfDue();
    const { searchParams } = new URL(request.url);
    const deviceId = searchParams.get('deviceId');
    if (!deviceId) {
        return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
    }

    const db = createDb();
    if (!db) return NextResponse.json(null);

    try {
        return NextResponse.json(await getUserByDevice(db, deviceId));
    } catch (error) {
        console.error('[API App Users ByDevice] Error:', error);
        return NextResponse.json({ error: 'Failed to load user' }, { status: 500 });
    }
}
