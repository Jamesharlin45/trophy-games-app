import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidEmail, normalizeEmail } from './email-outbox';
import {
    isLegacyDeviceId,
    isValidDeviceId,
    legacyDeviceAccessAllowed,
    LEGACY_ACCESS_DENIED_REASON,
} from '@/lib/device-id';

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
    /** When the access was removed via "Remove access" (admin or cron). */
    revokedAt?: string;
}

export interface DbMembershipRequest {
    _id: string;
    deviceId: string;
    username?: string;
    /** Where the approved token will be emailed. */
    email?: string;
    type: TokenType;
    status: RequestStatus;
    requestedAt: string;
    resolvedAt?: string;
    issuedToken?: string;
    /** When the granted access was removed via "Remove access" on the
     * requests page. The status column stays 'approved' — see
     * supabase/access_revoke_expiry.sql. */
    revokedAt?: string;
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
    revoked_at: string | null;
}

interface MembershipRequestRow {
    id: string;
    device_id: string;
    username: string | null;
    email: string | null;
    type: TokenType;
    status: RequestStatus;
    requested_at: string;
    resolved_at: string | null;
    issued_token: string | null;
    revoked_at: string | null;
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
        revokedAt: row.revoked_at ?? undefined,
    };
}

function mapRequest(row: MembershipRequestRow): DbMembershipRequest {
    return {
        _id: row.id,
        deviceId: row.device_id,
        username: row.username ?? undefined,
        email: row.email ?? undefined,
        type: row.type,
        status: row.status,
        requestedAt: row.requested_at,
        resolvedAt: row.resolved_at ?? undefined,
        issuedToken: row.issued_token ?? undefined,
        revokedAt: row.revoked_at ?? undefined,
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
    const { error } = await db.from('access_tokens').insert({
        convex_id: crypto.randomUUID(),
        convex_created_at: new Date().toISOString(),
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
    if (error) throw new Error(error.message);
    return { token: input.token };
}

/** Delete every unsent email row for a token (sent rows are kept as history).
 * Returns the number of rows actually deleted. */
export async function deletePendingOutboxForToken(db: SupabaseClient, token: string): Promise<number> {
    const { data, error } = await db
        .from('email_outbox')
        .delete()
        .eq('token', token)
        .is('sent_at', null)
        .select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length;
}

/** Delete every unsent email row attached to a membership request. */
export async function deletePendingOutboxForRequest(db: SupabaseClient, requestId: string): Promise<number> {
    const { data, error } = await db
        .from('email_outbox')
        .delete()
        .eq('request_id', requestId)
        .is('sent_at', null)
        .select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length;
}

/** A purchase-backed token must not be re-granted by the app's restore flow
 * after an admin deletes its access token. The purchase row stays as the
 * payment record, with status 'revoked'. */
async function revokePurchasesForToken(
    db: SupabaseClient,
    deviceId: string,
    type: TokenType,
): Promise<number> {
    const { data, error } = await db
        .from('purchases')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('device_id', deviceId)
        .eq('tier', type)
        .neq('status', 'revoked')
        .select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length;
}

/** Hard-delete an access token, its pending emails, and revoke the purchase
 * it came from. Verifies every affected row count. */
export async function deleteTokenHard(
    db: SupabaseClient,
    token: string,
): Promise<{ deletedTokens: number; deletedOutbox: number; revokedPurchases: number }> {
    const { data: rows, error: lookupError } = await db
        .from('access_tokens')
        .select('id, device_id, type')
        .eq('token', token)
        .limit(1);
    if (lookupError) throw new Error(lookupError.message);
    const row = (rows ?? [])[0] as { id: string; device_id: string; type: TokenType } | undefined;
    if (!row) return { deletedTokens: 0, deletedOutbox: 0, revokedPurchases: 0 };

    const { data: deleted, error: deleteError } = await db
        .from('access_tokens')
        .delete()
        .eq('token', token)
        .select('id');
    if (deleteError) throw new Error(deleteError.message);
    const deletedTokens = (deleted ?? []).length;
    const deletedOutbox = await deletePendingOutboxForToken(db, token);
    const revokedPurchases = await revokePurchasesForToken(db, row.device_id, row.type);
    return { deletedTokens, deletedOutbox, revokedPurchases };
}

/** Hard-delete a membership request plus the token it issued and that
 * token's pending emails. Verifies every affected row count. */
export async function deleteRequestHard(
    db: SupabaseClient,
    requestId: string,
): Promise<{
    deletedRequests: number;
    deletedTokens: number;
    deletedOutbox: number;
    revokedPurchases: number;
}> {
    const { data: rows, error: lookupError } = await db
        .from('membership_requests')
        .select('id, issued_token')
        .eq('id', requestId)
        .limit(1);
    if (lookupError) throw new Error(lookupError.message);
    const request = (rows ?? [])[0] as { id: string; issued_token: string | null } | undefined;
    if (!request) {
        return { deletedRequests: 0, deletedTokens: 0, deletedOutbox: 0, revokedPurchases: 0 };
    }

    const { data: deletedRequestRows, error: deleteRequestError } = await db
        .from('membership_requests')
        .delete()
        .eq('id', requestId)
        .select('id');
    if (deleteRequestError) throw new Error(deleteRequestError.message);

    let deletedTokens = 0;
    let deletedOutbox = await deletePendingOutboxForRequest(db, requestId);
    let revokedPurchases = 0;
    if (request.issued_token) {
        const result = await deleteTokenHard(db, request.issued_token);
        deletedTokens = result.deletedTokens;
        deletedOutbox += result.deletedOutbox;
        revokedPurchases = result.revokedPurchases;
    }
    return {
        deletedRequests: (deletedRequestRows ?? []).length,
        deletedTokens,
        deletedOutbox,
        revokedPurchases,
    };
}

/** api.tokens.revokeToken — deactivate by token and stamp revoked_at.
 * Also revokes every purchase linked to the same device and tier.
 * Returns how many access_tokens rows the update changed (0 when the
 * token is unknown or already revoked). */
export async function revokeToken(db: SupabaseClient, token: string): Promise<number> {
    // Look the row up by the same `token` column the list maps (getAllTokens).
    const { data: tokenRows, error: tokenError } = await db
        .from('access_tokens')
        .select('id, device_id, type')
        .eq('token', token)
        .limit(1);
    if (tokenError) throw new Error(tokenError.message);
    const tokenRow = (tokenRows ?? [])[0] as { id: string; device_id: string; type: TokenType } | undefined;
    if (!tokenRow) return 0;

    const { data: updated, error: updateError } = await db
        .from('access_tokens')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('token', token)
        .select('id');
    if (updateError) throw new Error(updateError.message);

    // Revoke every purchase linked to the same device and tier.
    const { error: purchaseError } = await db
        .from('purchases')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('device_id', tokenRow.device_id)
        .eq('tier', tokenRow.type);
    if (purchaseError) throw new Error(purchaseError.message);

    return (updated ?? []).length;
}

/** api.tokens.reactivateToken — reactivate by token and clear failures.
 * Also restores purchases revoked with the access back to 'verified'.
 * Returns how many access_tokens rows the update changed (0 when the
 * token is unknown or already active). */
export async function reactivateToken(db: SupabaseClient, token: string): Promise<number> {
    const { data: tokenRows, error: tokenError } = await db
        .from('access_tokens')
        .select('id, device_id, type')
        .eq('token', token)
        .limit(1);
    if (tokenError) throw new Error(tokenError.message);
    const tokenRow = (tokenRows ?? [])[0] as { id: string; device_id: string; type: TokenType } | undefined;
    if (!tokenRow) return 0;

    const { data: updated, error: updateError } = await db
        .from('access_tokens')
        .update({ is_active: true, revoked_at: null, failed_attempts: 0 })
        .eq('id', tokenRow.id)
        .select('id');
    if (updateError) throw new Error(updateError.message);

    // Restore purchases revoked with the access back to 'verified'.
    const { error: purchaseError } = await db
        .from('purchases')
        .update({ status: 'verified', updated_at: new Date().toISOString() })
        .eq('device_id', tokenRow.device_id)
        .eq('tier', tokenRow.type)
        .eq('status', 'revoked');
    if (purchaseError) throw new Error(purchaseError.message);

    return (updated ?? []).length;
}

/** Extend a token's expiry by `days` from now. Only the stored expiry is
 * moved — used by the Tokens page (Extend +7d/+30d). */
export async function extendToken(db: SupabaseClient, token: string, days: number): Promise<{ success: boolean; expiresAt?: string }> {
    const { data } = await db
        .from('access_tokens')
        .select('id')
        .eq('token', token)
        .limit(1);
    const row = (data ?? [])[0] as { id: string } | undefined;
    if (!row) return { success: false };
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await db.from('access_tokens').update({ expires_at: expiresAt }).eq('id', row.id);
    return { success: true, expiresAt };
}

/** Remove granted access from an approved membership request: marks the
 * request revoked_at and deactivates the issued token. Used by the
 * Requests page ("Remove access"). */
export async function revokeMembershipRequest(db: SupabaseClient, requestId: string): Promise<{ success: boolean }> {
    const { data } = await db
        .from('membership_requests')
        .select('status, issued_token')
        .eq('id', requestId)
        .limit(1);
    const request = (data ?? [])[0] as { status: string; issued_token: string | null } | undefined;
    if (!request) return { success: false };
    const now = new Date().toISOString();
    await db.from('membership_requests').update({ revoked_at: now }).eq('id', requestId);
    if (request.status === 'approved' && request.issued_token) {
        await db.from('access_tokens').update({ is_active: false, revoked_at: now }).eq('token', request.issued_token);
    }
    return { success: true };
}

/** Extend the token issued by an approved membership request by `days`. */
export async function extendMembershipRequestToken(
    db: SupabaseClient,
    requestId: string,
    days: number,
): Promise<{ success: boolean; expiresAt?: string }> {
    const { data } = await db
        .from('membership_requests')
        .select('issued_token')
        .eq('id', requestId)
        .limit(1);
    const request = (data ?? [])[0] as { issued_token: string | null } | undefined;
    if (!request?.issued_token) return { success: false };
    return extendToken(db, request.issued_token, days);
}

/** Mark grants whose expiry has passed as expired (is_active = false) so the
 * app endpoints count them as inactive even before anyone revokes them.
 * Returns the number of grants marked. */
export async function markExpiredGrantsAsExpired(db: SupabaseClient): Promise<number> {
    const now = new Date().toISOString();
    const { data } = await db
        .from('access_tokens')
        .select('id')
        .eq('is_active', true)
        .lt('expires_at', now);
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (ids.length === 0) return 0;
    await db.from('access_tokens').update({ is_active: false }).in('id', ids);
    return ids.length;
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
export interface ApproveMembershipResult {
    success: boolean;
    token?: string;
    deviceId?: string;
    username?: string;
    email?: string;
    type?: TokenType;
    expiresAt?: string;
}

export async function approveMembershipRequest(
    db: SupabaseClient,
    input: {
        requestId: string;
        token: string;
        matchId?: string;
        expiresAt?: string;
        /** Admin-supplied fallback only when the request has no valid email. */
        email?: string;
    },
): Promise<ApproveMembershipResult> {
    const { data, error: lookupError } = await db
        .from('membership_requests')
        .select('*')
        .eq('id', input.requestId)
        .limit(1);
    if (lookupError) throw new Error(lookupError.message);
    const request = data && data.length > 0 ? data[0] as MembershipRequestRow : null;
    if (!request) return { success: false };

    const email = input.email ? normalizeEmail(input.email) : request.email ?? undefined;
    const now = new Date().toISOString();
    const { error: updateError } = await db
        .from('membership_requests')
        .update({
            status: 'approved',
            resolved_at: now,
            issued_token: input.token,
            ...(email ? { email } : {}),
        })
        .eq('id', input.requestId);
    if (updateError) throw new Error(updateError.message);

    const { error: insertError } = await db.from('access_tokens').insert({
        convex_id: crypto.randomUUID(),
        convex_created_at: now,
        token: input.token,
        device_id: request.device_id,
        username: request.username,
        type: request.type,
        match_id: input.matchId ?? null,
        created_at: now,
        expires_at: input.expiresAt ?? null,
        is_active: true,
        is_claimed: false,
        failed_attempts: 0,
    });
    if (insertError) throw new Error(insertError.message);

    return {
        success: true,
        token: input.token,
        deviceId: request.device_id,
        username: request.username ?? undefined,
        email,
        type: request.type,
        expiresAt: input.expiresAt ?? undefined,
    };
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
    device_id: string;
    type: TokenType;
    username: string | null;
    match_id: string | null;
    expires_at: string | null;
    is_active: boolean;
    is_claimed: boolean;
    claimed_at: string | null;
    revoked_at: string | null;
}

interface MembershipRequestLookupRow {
    id: string;
    device_id: string;
    status: RequestStatus;
    issued_token: string | null;
    revoked_at: string | null;
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

/** A revoked purchase for the same device and tier must never grant access,
 * even if its token row was somehow left active. */
async function hasRevokedPurchase(db: SupabaseClient, deviceId: string, type: TokenType): Promise<boolean> {
    const { data, error } = await db
        .from('purchases')
        .select('id')
        .eq('device_id', deviceId)
        .eq('tier', type)
        .eq('status', 'revoked')
        .limit(1);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
}

/** Shared implementation — the Convex verifyTokenImpl, ported 1:1
 * (both verifyToken and claimToken run it). */
async function verifyTokenImpl(
    db: SupabaseClient,
    args: { token: string; deviceId: string; username?: string },
): Promise<VerifyTokenResult> {
    if (isLegacyDeviceId(args.deviceId) && !legacyDeviceAccessAllowed()) {
        return { valid: false, reason: LEGACY_ACCESS_DENIED_REASON };
    }

    // Find user (same rule as Convex: by username, else by device).
    const user = await findUser(db, args);

    // A username lookup must not bypass the legacy gate via an old user row.
    if (user && isLegacyDeviceId(user.device_id) && !legacyDeviceAccessAllowed()) {
        return { valid: false, reason: LEGACY_ACCESS_DENIED_REASON };
    }

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
    if (tokenDoc.revoked_at) return { valid: false, reason: 'Token revoked' };
    if (tokenDoc.expires_at && new Date(tokenDoc.expires_at) < new Date()) {
        return { valid: false, reason: 'Token expired' };
    }
    if (isLegacyDeviceId(tokenDoc.device_id) && !legacyDeviceAccessAllowed()) {
        return { valid: false, reason: LEGACY_ACCESS_DENIED_REASON };
    }
    if (await hasRevokedPurchase(db, tokenDoc.device_id, tokenDoc.type)) {
        return { valid: false, reason: 'Purchase access was revoked' };
    }

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
    input: { deviceId: string; username?: string; type: TokenType; email: string },
): Promise<MembershipRequestResult> {
    const email = normalizeEmail(input.email);
    if (!isValidDeviceId(input.deviceId)) {
        return { success: false, reason: 'Invalid device id' };
    }
    if (!isValidEmail(email)) {
        return { success: false, reason: 'Invalid email address' };
    }

    // Per-device rate limit: at most three manual requests per hour, so a
    // single device cannot flood the admin queue.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentRows } = await db
        .from('membership_requests')
        .select('id')
        .eq('device_id', input.deviceId)
        .gte('requested_at', since)
        .limit(3);
    if (recentRows && recentRows.length >= 3) {
        return { success: false, reason: 'Rate limited: please try again later' };
    }

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
            email,
            type: input.type,
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

/** True only for an unclaimed, active, unexpired, non-revoked token issued by
 * an approved request. A deleted/inactive/expired/claimed token is no longer
 * "approved" — the app must show "none" until the user claims a real token. */
function isPendingApprovalToken(token: AccessTokenLookupRow, now: Date): boolean {
    return (
        token.is_active === true &&
        !token.revoked_at &&
        (!token.expires_at || new Date(token.expires_at) > now) &&
        token.is_claimed === false
    );
}

/** api.tokens.getMembershipStatus — 'active' only for a live claimed token,
 * 'approved' only while the approved request's unclaimed token is still live,
 * otherwise 'none' (or a still-pending/rejected request state). */
export async function getMembershipStatus(
    db: SupabaseClient,
    input: { deviceId: string; username?: string; type: TokenType },
): Promise<MembershipStatusResult> {
    const legacyDenied = isLegacyDeviceId(input.deviceId) && !legacyDeviceAccessAllowed();
    if (legacyDenied) return { status: 'none' };

    const now = new Date();
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
        (t) =>
            t.is_active === true &&
            t.is_claimed === true &&
            !t.revoked_at &&
            (!t.expires_at || new Date(t.expires_at) > now) &&
            !(isLegacyDeviceId(t.device_id) && !legacyDeviceAccessAllowed()),
    );
    if (validToken && !(await hasRevokedPurchase(db, validToken.device_id, validToken.type))) {
        return { status: 'active', token: validToken.token, matchId: validToken.match_id ?? undefined };
    }

    const { data: requestRows } = await db
        .from('membership_requests')
        .select('id, device_id, status, issued_token, revoked_at')
        .eq('device_id', input.deviceId)
        .eq('type', input.type)
        .order('created_at', { ascending: false })
        .limit(1);
    if (!requestRows || requestRows.length === 0) {
        return { status: 'none' };
    }
    const request = requestRows[0] as MembershipRequestLookupRow;
    // A revoked latest request means the user has no access — don't fall
    // through to an older approved request.
    if (request.revoked_at) return { status: 'none' };
    if (request.status === 'pending' || request.status === 'rejected') {
        return { status: request.status, requestId: request.id };
    }

    // 'approved' is a derived state, never a stored promise of access.
    if (!request.issued_token) return { status: 'none' };
    const { data: issuedRows, error } = await db
        .from('access_tokens')
        .select('*')
        .eq('token', request.issued_token)
        .limit(1);
    if (error) throw new Error(error.message);
    const issuedToken = (issuedRows ?? [])[0] as AccessTokenLookupRow | undefined;
    if (!issuedToken) return { status: 'none' };
    if (
        issuedToken.device_id !== request.device_id &&
        issuedToken.device_id !== input.deviceId
    ) {
        return { status: 'none' };
    }
    if (!isPendingApprovalToken(issuedToken, now)) return { status: 'none' };
    if (isLegacyDeviceId(issuedToken.device_id) && !legacyDeviceAccessAllowed()) {
        return { status: 'none' };
    }
    if (await hasRevokedPurchase(db, issuedToken.device_id, issuedToken.type)) {
        return { status: 'none' };
    }
    return { status: 'approved', requestId: request.id };
}
