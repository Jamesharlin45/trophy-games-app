import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { createToken, getAllRequests, getAllTokens, reactivateToken, revokeToken } from '@/lib/db/tokens';
import type { TokenType } from '@/lib/db/tokens';
import { enqueueTokenEmail, getEmailStatusesForTokens } from '@/lib/db/email-outbox';
import { scheduleDueEmails } from '@/lib/email-opportunistic';

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
        const statuses = await getEmailStatusesForTokens(db, tokens.map((t) => t.token));

        // Prefill addresses from the originating purchase or manual request.
        const { data: purchaseRows } = await db
            .from('purchases')
            .select('device_id, tier, email')
            .not('email', 'is', null);
        const { data: requestRows } = await db
            .from('membership_requests')
            .select('issued_token, email')
            .not('issued_token', 'is', null)
            .not('email', 'is', null);
        const purchaseEmails = new Map(
            ((purchaseRows ?? []) as Array<{ device_id: string; tier: string; email: string }>).map(
                (row) => [`${row.device_id}|${row.tier}`, row.email],
            ),
        );
        const requestEmails = new Map(
            ((requestRows ?? []) as Array<{ issued_token: string; email: string }>).map((row) => [
                row.issued_token,
                row.email,
            ]),
        );

        return NextResponse.json(
            tokens.map((token) => ({
                ...token,
                email:
                    requestEmails.get(token.token) ??
                    purchaseEmails.get(`${token.deviceId}|${token.type}`) ??
                    undefined,
                emailStatus: statuses.get(token.token) ?? { status: 'none' },
            })),
        );
    } catch (error) {
        console.error('[API] Get tokens failed:', error);
        return NextResponse.json({ error: 'Failed to load tokens' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { deviceId, username, type, matchId, expiresAt, email, requestId } = (await request.json()) as {
            deviceId?: string;
            username?: string;
            type?: TokenType;
            matchId?: string;
            expiresAt?: string;
            email?: string;
            requestId?: string;
        };

        if (!deviceId || !type) {
            return NextResponse.json({ error: 'deviceId and type required' }, { status: 400 });
        }

        // When a token is created for a manual request, prefill the address
        // from that request unless the admin typed a different one.
        let toEmail = email;
        if (!toEmail && requestId) {
            const req = (await getAllRequests(db)).find((item) => item._id === requestId);
            toEmail = req?.email;
        }

        const token = generateToken(type);
        await createToken(db, { token, deviceId, username, type, matchId, expiresAt });

        const queued = toEmail
            ? await enqueueTokenEmail(db, {
                  token,
                  toEmail,
                  tier: type,
                  expiresAt,
                  requestId: requestId ?? null,
                  dueNow: true,
              })
            : null;
        if (queued?.success) scheduleDueEmails();

        return NextResponse.json({
            success: true,
            token,
            ...(queued ? { emailQueued: queued.success } : {}),
            ...(queued && !queued.success ? { emailError: queued.reason } : {}),
        });
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
