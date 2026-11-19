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
