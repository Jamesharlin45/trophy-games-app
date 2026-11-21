import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { setPurchaseEmail } from '@/lib/db/email-outbox';
import { isCronRequestAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

// POST /api/app/purchases/set-email — the mobile app calls this right after
// a successful Google Play purchase (VIP or Paid) so the buyer can receive
// their access token by email. Validates the email, saves it on the purchase
// and inserts ONE outbox row for the purchase's access token, scheduled
// EMAIL_DELAY_MINUTES from now. Idempotent: calling twice updates the pending
// row instead of creating a second email. The schedule is shortened to
// immediate only when the caller presents the CRON_SECRET (same helper as
// the cron routes); every other caller gets the normal delay.
export async function POST(request: Request) {
    triggerDueEmailsIfDue();
    const db = createDb();
    if (!db) {
        return NextResponse.json({ success: false, reason: 'Supabase not configured' }, { status: 500 });
    }

    let body: Record<string, unknown> | null = null;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch (error) {
        console.error('[API App Purchases SetEmail] Invalid JSON body:', error);
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const deviceId = readString(body?.deviceId);
    const purchaseToken = readString(body?.purchaseToken);
    const email = readString(body?.email);
    if (!deviceId || !purchaseToken || !email) {
        return NextResponse.json(
            { error: 'deviceId, purchaseToken and email are required' },
            { status: 400 },
        );
    }
    // Only callers presenting the CRON_SECRET can shorten the schedule.
    const dueNow = body.dueNow === true && isCronRequestAuthorized(request);

    try {
        return NextResponse.json(await setPurchaseEmail(db, { deviceId, purchaseToken, email, dueNow }));
    } catch (error) {
        console.error('[API App Purchases SetEmail] Error:', error);
        return NextResponse.json({ success: false, reason: 'Failed to set email' }, { status: 500 });
    }
}
