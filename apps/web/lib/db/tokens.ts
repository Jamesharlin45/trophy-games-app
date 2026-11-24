import type { SupabaseClient } from '@supabase/supabase-js';

export type TokenType = 'vip' | 'paid';
export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface DbAccessToken {
    _id: string;
    token: string;
    deviceId: string;
    username?: string;
    type: TokenType;
    matchId?: string;
    createdAt: string;
    expiresAt?: string;
    isActive: boolean;
    isClaimed: boolean;
    claimedAt?: string;
    failedAttempts?: number;
}

export interface DbMembershipRequest {
    _id: string;
    deviceId: string;
    username?: string;
    type: TokenType;
    email?: string;
    status: RequestStatus;
    requestedAt: string;
    resolvedAt?: string;
    issuedToken?: string;
}

interface AccessTokenRow {
    id: string;
    token: string;
    device_id: string;
    username: string | null;
    type: TokenType;
    match_id: string | null;
    created_at: string;
    expires_at: string | null;
    is_active: boolean;
    is_claimed: boolean;
    claimed_at: string | null;
    failed_attempts: number | null;
}

interface MembershipRequestRow {
    id: string;
    device_id: string;
    username: string | null;
    type: TokenType;
    email: string | null;
    status: RequestStatus;
    requested_at: string;
    resolved_at: string | null;
    issued_token: string | null;
}

function mapToken(row: AccessTokenRow): DbAccessToken {
    return {
        _id: row.id,
        token: row.token,
        deviceId: row.device_id,
        username: row.username ?? undefined,
        type: row.type,
        matchId: row.match_id ?? undefined,
        createdAt: row.created_at,
        expiresAt: row.expires_at ?? undefined,
        isActive: row.is_active,
        isClaimed: row.is_claimed,
        claimedAt: row.claimed_at ?? undefined,
        failedAttempts: row.failed_attempts ?? undefined,
    };
}

function mapRequest(row: MembershipRequestRow): DbMembershipRequest {
    return {
        _id: row.id,
        deviceId: row.device_id,
        username: row.username ?? undefined,
        type: row.type,
        email: row.email ?? undefined,
        status: row.status,
        requestedAt: row.requested_at,
        resolvedAt: row.resolved_at ?? undefined,
        issuedToken: row.issued_token ?? undefined,
    };
}

/** api.tokens.getAllTokens — newest first, capped at 200. */
export async function getAllTokens(db: SupabaseClient): Promise<DbAccessToken[]> {
    const { data } = await db
        .from('access_tokens')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
    return ((data ?? []) as AccessTokenRow[]).map(mapToken);
}

/** api.tokens.createToken — insert an active, unclaimed token row. */
export async function createToken(
    db: SupabaseClient,
    input: { token: string; deviceId: string; username?: string; type: TokenType; matchId?: string; expiresAt?: string },
): Promise<{ token: string }> {
    await db.from('access_tokens').insert({
        token: input.token,
        device_id: input.deviceId,
        username: input.username ?? null,
        type: input.type,
        match_id: input.matchId ?? null,
        created_at: new Date().toISOString(),
        expires_at: input.expiresAt ?? null,
        is_active: true,
        is_claimed: false,
        failed_attempts: 0,
    });
    return { token: input.token };
}

/** api.tokens.revokeToken — deactivate by token. */
export async function revokeToken(db: SupabaseClient, token: string): Promise<void> {
    await db.from('access_tokens').update({ is_active: false }).eq('token', token);
}

/** api.tokens.reactivateToken — reactivate by token and clear failures. */
export async function reactivateToken(db: SupabaseClient, token: string): Promise<void> {
    await db.from('access_tokens').update({ is_active: true, failed_attempts: 0 }).eq('token', token);
}

/** api.tokens.getAllRequests — all membership requests, newest first. */
export async function getAllRequests(db: SupabaseClient): Promise<DbMembershipRequest[]> {
    const { data } = await db
        .from('membership_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
    return ((data ?? []) as MembershipRequestRow[]).map(mapRequest);
}

/** api.tokens.approveMembershipRequest — mark approved, stamp the token and
 * issue the access token row. */
export async function approveMembershipRequest(
    db: SupabaseClient,
    input: { requestId: string; token: string; matchId?: string; expiresAt?: string },
): Promise<{ success: boolean }> {
    const { data } = await db
        .from('membership_requests')
        .select('*')
        .eq('id', input.requestId)
        .limit(1);
    const request = data && data.length > 0 ? data[0] as MembershipRequestRow : null;
    if (!request) return { success: false };

    await db
        .from('membership_requests')
        .update({
            status: 'approved',
            resolved_at: new Date().toISOString(),
            issued_token: input.token,
        })
        .eq('id', input.requestId);

    await db.from('access_tokens').insert({
        token: input.token,
        device_id: request.device_id,
        username: request.username,
        type: request.type,
        match_id: input.matchId ?? null,
        created_at: new Date().toISOString(),
        expires_at: input.expiresAt ?? null,
        is_active: true,
        is_claimed: false,
        failed_attempts: 0,
    });

    return { success: true };
}

/** api.tokens.rejectMembershipRequest — mark rejected and stamp resolution. */
export async function rejectMembershipRequest(db: SupabaseClient, input: { requestId: string }): Promise<{ success: boolean }> {
    await db
        .from('membership_requests')
        .update({ status: 'rejected', resolved_at: new Date().toISOString() })
        .eq('id', input.requestId);
    return { success: true };
}

// ---------------------------------------------------------------------------
// Ports of the Convex api.tokens functions the mobile app calls
// (tokens.requestMembership, claimToken, verifyToken, getMembershipStatus).
// The JSON shapes below mirror the Convex results the mobile app receives.
// No server-side access checks exist in Convex for these — the web port
// likewise uses the service-role client with no extra authorization.
// ---------------------------------------------------------------------------

/** api.tokens.requestMembership (aliased as api.tokens.createMembershipRequest).
 * Returns the Convex-shaped result: { success, requestId } or
 * { success: false, reason, requestId } when a request is already pending. */
export type MembershipRequestResult =
    | { success: true; requestId: string }
    | { success: false; reason: string; requestId?: string };

/** api.tokens.claimToken — mobile alias of the verification: { success, reason?, type?, matchId? }. */
export type ClaimTokenResult =
    | { success: false; reason: string }
    | { success: true; type: TokenType; matchId?: string };

/** api.tokens.verifyToken — public verification: { valid, reason?, type?, matchId? }. */
export type VerifyTokenResult =
    | { valid: false; reason: string }
    | { valid: true; type: TokenType; matchId?: string };

/** api.tokens.getMembershipStatus — active token, latest request, or 'none'. */
export type MembershipStatusResult =
    | { status: 'active'; token: string; matchId?: string }
    | { status: 'none' }
    | { status: RequestStatus; requestId: string };

interface UsersTableRow {
    id: string;
    username: string;
    device_id: string;
    is_blocked: boolean | null;
    failed_attempts: number | null;
    last_active_at: string | null;
    last_failed_at: string | null;
}

interface AccessTokenLookupRow {
    id: string;
    token: string;
    type: TokenType;
    username: string | null;
    match_id: string | null;
    expires_at: string | null;
    is_active: boolean;
    is_claimed: boolean;
    claimed_at: string | null;
}

interface MembershipRequestLookupRow {
    id: string;
    status: RequestStatus;
}

/** Port of the Convex user lookup in verifyTokenImpl: by username when
 * provided, otherwise by device. */
async function findUser(
    db: SupabaseClient,
    args: { deviceId: string; username?: string },
): Promise<UsersTableRow | null> {
    let row: UsersTableRow | null = null;
    if (args.username) {
        const { data } = await db.from('users').select('*').eq('username', args.username).limit(1);
        row = data && data.length > 0 ? (data[0] as UsersTableRow) : null;
    } else {
        const { data } = await db.from('users').select('*').eq('device_id', args.deviceId).limit(1);
        row = data && data.length > 0 ? (data[0] as UsersTableRow) : null;
    }
    return row;
}

/** Shared implementation — the Convex verifyTokenImpl, ported 1:1
 * (both verifyToken and claimToken run it). */
async function verifyTokenImpl(
    db: SupabaseClient,
    args: { token: string; deviceId: string; username?: string },
): Promise<VerifyTokenResult> {
    // Find user (same rule as Convex: by username, else by device).
    const user = await findUser(db, args);

    if (user?.is_blocked) {
        return { valid: false, reason: 'Account is blocked. Contact support.' };
    }

    if (user && (user.failed_attempts ?? 0) >= 5) {
        return { valid: false, reason: 'Too many failed attempts. Account locked.' };
    }

    const { data: tokenRows } = await db.from('access_tokens').select('*').eq('token', args.token).limit(1);
    const tokenDoc = tokenRows && tokenRows.length > 0 ? (tokenRows[0] as AccessTokenLookupRow) : null;

    if (!tokenDoc) {
        if (user) {
            await db
                .from('users')
                .update({
                    failed_attempts: (user.failed_attempts ?? 0) + 1,
                    last_failed_at: new Date().toISOString(),
                })
                .eq('id', user.id);
        }
        return { valid: false, reason: 'Token not found' };
    }

    if (!tokenDoc.is_active) return { valid: false, reason: 'Token is inactive' };

    // Strict username binding check (if provided during token creation).
    if (tokenDoc.username && tokenDoc.username !== args.username) {
        if (user) {
            await db
                .from('users')
                .update({
                    failed_attempts: (user.failed_attempts ?? 0) + 1,
                    last_failed_at: new Date().toISOString(),
                })
                .eq('id', user.id);
        }
        return { valid: false, reason: 'Token bound to different username' };
    }

    if (tokenDoc.expires_at && new Date(tokenDoc.expires_at) < new Date()) {
        return { valid: false, reason: 'Token expired' };
    }

    // Success! Reset failed attempts and mark activity.
    if (user) {
        await db
            .from('users')
            .update({ failed_attempts: 0, last_active_at: new Date().toISOString() })
            .eq('id', user.id);
    }

    if (!tokenDoc.is_claimed) {
        // Also bind the token to this username if it wasn't already claimed.
        await db
            .from('access_tokens')
            .update({ is_claimed: true, username: args.username ?? null, claimed_at: new Date().toISOString() })
            .eq('id', tokenDoc.id);
    }

    return { valid: true, type: tokenDoc.type, matchId: tokenDoc.match_id ?? undefined };
}

/** api.tokens.verifyToken — public verification. */
export async function verifyToken(
    db: SupabaseClient,
    args: { token: string; deviceId: string; username?: string },
): Promise<VerifyTokenResult> {
    return verifyTokenImpl(db, args);
}

/** api.tokens.claimToken — the mobile alias: same verification, result
 * shaped with `success`. */
export async function claimToken(
    db: SupabaseClient,
    args: { token: string; deviceId: string; username?: string },
): Promise<ClaimTokenResult> {
    const result = await verifyTokenImpl(db, args);
    if (!result.valid) return { success: false, reason: result.reason };
    return { success: true, type: result.type, matchId: result.matchId };
}

/** api.tokens.requestMembership — Convex rules: a pending request for the
 * same device+type blocks new ones. */
export async function requestMembership(
    db: SupabaseClient,
    input: { deviceId: string; username?: string; type: TokenType; email?: string },
): Promise<MembershipRequestResult> {
    const { data: existingRows } = await db
        .from('membership_requests')
        .select('id')
        .eq('device_id', input.deviceId)
        .eq('type', input.type)
        .eq('status', 'pending')
        .limit(1);
    if (existingRows && existingRows.length > 0) {
        const existing = existingRows[0] as { id: string };
        return { success: false, reason: 'Request already pending', requestId: existing.id };
    }

    const now = new Date().toISOString();
    const { data: inserted, error } = await db
        .from('membership_requests')
        .insert({
            convex_id: crypto.randomUUID(),
            device_id: input.deviceId,
            username: input.username ?? null,
            type: input.type,
            email: input.email ?? null,
            status: 'pending',
            requested_at: now,
        })
        .select('id')
        .limit(1);
    if (error || !inserted || inserted.length === 0) {
        throw new Error(error?.message ?? 'Failed to create membership request');
    }
    return { success: true, requestId: (inserted[0] as { id: string }).id };
}

/** api.tokens.getMembershipStatus — active token, else the latest request
 * for the device+type, else 'none'. */
export async function getMembershipStatus(
    db: SupabaseClient,
    input: { deviceId: string; username?: string; type: TokenType },
): Promise<MembershipStatusResult> {
    let tokenRows: AccessTokenLookupRow[];
    if (input.username) {
        const { data } = await db
            .from('access_tokens')
            .select('*')
            .eq('username', input.username)
            .eq('type', input.type)
            .eq('is_active', true);
        tokenRows = (data ?? []) as AccessTokenLookupRow[];
    } else {
        const { data } = await db
            .from('access_tokens')
            .select('*')
            .eq('device_id', input.deviceId)
            .eq('type', input.type)
            .eq('is_active', true);
        tokenRows = (data ?? []) as AccessTokenLookupRow[];
    }

    const validToken = tokenRows.find(
        (t) => (!t.expires_at || new Date(t.expires_at) > new Date()) && t.is_claimed !== false,
    );
    if (validToken) {
        return { status: 'active', token: validToken.token, matchId: validToken.match_id ?? undefined };
    }

    const { data: requestRows } = await db
        .from('membership_requests')
        .select('id, status')
        .eq('device_id', input.deviceId)
        .eq('type', input.type)
        .order('created_at', { ascending: false })
        .limit(1);
    if (!requestRows || requestRows.length === 0) {
        return { status: 'none' };
    }
    const request = requestRows[0] as MembershipRequestLookupRow;
    return { status: request.status, requestId: request.id };
}
