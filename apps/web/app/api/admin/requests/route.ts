import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import {
    approveMembershipRequest,
    deleteRequestHard,
    extendMembershipRequestToken,
    getAllRequests,
    rejectMembershipRequest,
    revokeMembershipRequest,
} from '@/lib/db/tokens';
import {
    enqueueTokenEmail,
    getEmailStatusesForTokens,
    isValidEmail,
    maskEmail,
    normalizeEmail,
    recordEmailFailure,
} from '@/lib/db/email-outbox';
import { redactSmtpSecrets } from '@/lib/email-diagnostics';
import { scheduleTokenEmail } from '@/lib/email-opportunistic';

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

/** Map the outbox state to the three states shown to the admin. */
function emailState(status: string | undefined): 'sent' | 'queued' | 'failed' {
    if (status === 'sent') return 'sent';
    if (status === 'failed') return 'failed';
    return 'queued';
}

export async function GET() {
    const db = createDb();
    if (!db) return NextResponse.json([]);
    try {
        const requests = await getAllRequests(db);
        const issuedTokens = requests
            .map((request) => request.issuedToken)
            .filter((token): token is string => Boolean(token));
        const statuses = await getEmailStatusesForTokens(db, issuedTokens);
        return NextResponse.json(
            requests.map((request) => {
                const status = request.issuedToken ? statuses.get(request.issuedToken) : undefined;
                return {
                    ...request,
                    emailStatus: status?.status ?? 'none',
                    emailError: status?.lastError
                        ? redactSmtpSecrets(status.lastError)
                        : undefined,
                };
            }),
        );
    } catch (error) {
        console.error('[API] Get requests failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const body = (await request.json()) as {
            requestId?: string;
            action?: string;
            matchId?: string;
            expiresAt?: string;
            days?: 7 | 30;
            email?: string;
        };
        const { requestId, action, matchId, expiresAt, days } = body;

        if (!requestId || !action) {
            return NextResponse.json({ error: 'requestId and action required' }, { status: 400 });
        }

        if (action === 'approve') {
            const allRequests = await getAllRequests(db);
            const req = allRequests.find((row) => row._id === requestId);
            if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

            // The recipient is ALWAYS the address on this request. An admin
            // may supply one only when the request has none. Never the admin's
            // address and never the SMTP_FROM/SMTP_USER address.
            const storedEmail = normalizeEmail(req.email ?? '');
            const typedEmail = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
            const recipient = isValidEmail(storedEmail) ? storedEmail : typedEmail;
            if (!recipient) {
                return NextResponse.json(
                    { error: 'No email on this request', needsEmail: true, requestId, requestDeviceId: req.deviceId },
                    { status: 400 },
                );
            }
            if (!isValidEmail(recipient)) {
                return NextResponse.json(
                    { error: 'Invalid email address', needsEmail: true, requestId },
                    { status: 400 },
                );
            }

            const token = generateToken(req.type);
            const approved = await approveMembershipRequest(db, {
                requestId,
                token,
                matchId,
                expiresAt,
                email: recipient,
            });
            if (!approved.success) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

            let queued: Awaited<ReturnType<typeof enqueueTokenEmail>>;
            try {
                queued = await enqueueTokenEmail(db, {
                    token,
                    toEmail: recipient,
                    tier: approved.type ?? req.type,
                    expiresAt,
                    requestId,
                    dueNow: true,
                });
            } catch (error) {
                const reason = redactSmtpSecrets(
                    error instanceof Error ? error.message : 'Failed to queue email',
                );
                await recordEmailFailure(db, {
                    token,
                    toEmail: recipient,
                    tier: approved.type ?? req.type,
                    expiresAt,
                    requestId,
                    reason,
                });
                queued = { success: false, reason };
            }

            if (!queued.success) {
                return NextResponse.json({
                    success: true,
                    token,
                    requestId,
                    deviceId: approved.deviceId,
                    username: approved.username,
                    type: approved.type ?? req.type,
                    email: maskEmail(recipient),
                    emailStatus: 'failed',
                    emailError: redactSmtpSecrets(queued.reason),
                    needsEmail: false,
                });
            }

            // Due now: send inside after() once the response is flushed.
            scheduleTokenEmail(token);
            const statuses = await getEmailStatusesForTokens(db, [token]);
            const state = emailState(statuses.get(token)?.status ?? (queued.action === 'already_sent' ? 'sent' : 'pending'));
            return NextResponse.json({
                success: true,
                token,
                requestId,
                deviceId: approved.deviceId,
                username: approved.username,
                type: approved.type ?? req.type,
                email: maskEmail(recipient),
                emailStatus: state,
                ...(statuses.get(token)?.lastError
                    ? { emailError: redactSmtpSecrets(statuses.get(token)?.lastError ?? '') }
                    : {}),
            });
        }

        if (action === 'reject') {
            await rejectMembershipRequest(db, { requestId });
            return NextResponse.json({ success: true });
        }

        if (action === 'revoke') {
            const result = await revokeMembershipRequest(db, requestId);
            if (!result.success) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            return NextResponse.json({ success: true });
        }

        if (action === 'extend') {
            if (days !== 7 && days !== 30) {
                return NextResponse.json({ error: 'days must be 7 or 30' }, { status: 400 });
            }
            const result = await extendMembershipRequestToken(db, requestId, days);
            if (!result.success) return NextResponse.json({ error: 'Request has no issued token' }, { status: 400 });
            return NextResponse.json({ success: true, expiresAt: result.expiresAt });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('[API] Handle request failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to handle request' }, { status: 500 });
    }
}

/** Hard delete a request, its issued token and its pending outbox rows. */
export async function DELETE(request: Request) {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const { requestId } = (await request.json()) as { requestId?: string };
        if (!requestId) return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
        const result = await deleteRequestHard(db, requestId);
        if (result.deletedRequests === 0) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        console.error('[API] Delete request failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to delete request' }, { status: 500 });
    }
}
