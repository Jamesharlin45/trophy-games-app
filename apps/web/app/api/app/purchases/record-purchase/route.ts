import { NextResponse } from 'next/server';
import { triggerDueEmailsIfDue } from '@/lib/email-opportunistic';
import { createDb } from '@/lib/db/client';
import { recordPurchase } from '@/lib/db/purchases';
import { isValidDeviceId } from '@/lib/device-id';

export const dynamic = 'force-dynamic';

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

// Port of the Convex `purchases.recordPurchase` mutation the mobile app calls.
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
        console.error('[API App Purchases RecordPurchase] Invalid JSON body:', error);
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const deviceId = readString(body?.deviceId);
    const productId = readString(body?.productId);
    const purchaseToken = readString(body?.purchaseToken);
    const transactionId = readString(body?.transactionId);
    const receiptData = readString(body?.receiptData);
    if (!deviceId || !productId || !purchaseToken || !isValidDeviceId(deviceId)) {
        return NextResponse.json(
            { error: 'valid deviceId, productId and purchaseToken are required' },
            { status: 400 },
        );
    }

    try {
        return NextResponse.json(
            await recordPurchase(db, { deviceId, productId, purchaseToken, transactionId, receiptData }),
        );
    } catch (error) {
        console.error('[API App Purchases RecordPurchase] Error:', error);
        return NextResponse.json({ error: 'Failed to record purchase' }, { status: 500 });
    }
}
