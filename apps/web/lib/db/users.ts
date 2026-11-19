import type { SupabaseClient } from '@supabase/supabase-js';

export interface DbUser {
    _id: string;
    username: string;
    deviceId: string;
    createdAt: string;
    lastActiveAt?: string;
    isBlocked?: boolean;
    failedAttempts?: number;
    lastFailedAt?: string;
}

interface UserRow {
    id: string;
    username: string;
    device_id: string;
    created_at: string;
    last_active_at: string | null;
    is_blocked: boolean | null;
    failed_attempts: number | null;
    last_failed_at: string | null;
}

function mapUser(row: UserRow): DbUser {
    return {
        _id: row.id,
        username: row.username,
        deviceId: row.device_id,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at ?? undefined,
        isBlocked: row.is_blocked ?? undefined,
        failedAttempts: row.failed_attempts ?? undefined,
        lastFailedAt: row.last_failed_at ?? undefined,
    };
}

/** api.users.getAllUsers. */
export async function getAllUsers(db: SupabaseClient): Promise<DbUser[]> {
    const { data } = await db.from('users').select('*').order('created_at', { ascending: false }).limit(500);
    return ((data ?? []) as UserRow[]).map(mapUser);
}

/** api.users.blockUser. */
export async function blockUser(db: SupabaseClient, username: string): Promise<void> {
    await db.from('users').update({ is_blocked: true }).eq('username', username);
}

/** api.users.unblockUser. */
export async function unblockUser(db: SupabaseClient, username: string): Promise<void> {
    await db.from('users').update({ is_blocked: false, failed_attempts: 0 }).eq('username', username);
}

/** api.users.clearFailedAttempts. */
export async function clearFailedAttempts(db: SupabaseClient, username: string): Promise<void> {
    await db.from('users').update({ failed_attempts: 0, is_blocked: false }).eq('username', username);
}

/** api.users.checkUsername — true when the username is not taken. */
export async function checkUsername(db: SupabaseClient, username: string): Promise<{ available: boolean }> {
    const { data } = await db.from('users').select('id').eq('username', username).limit(1);
    return { available: !(data && data.length > 0) };
}

/** api.users.registerUser — Convex port, same rules: the username-taken
 * check runs first, then an already-registered device is rebound to the new
 * username (with lastActiveAt), otherwise a new user row is inserted
 * (isBlocked: false). */
export async function registerUser(
    db: SupabaseClient,
    username: string,
    deviceId: string,
): Promise<{ success: boolean; reason?: string }> {
    const { data: byUsername } = await db.from('users').select('id').eq('username', username).limit(1);
    if (byUsername && byUsername.length > 0) {
        return { success: false, reason: 'Username already taken' };
    }

    const { data: byDevice } = await db.from('users').select('id').eq('device_id', deviceId).limit(1);
    if (byDevice && byDevice.length > 0) {
        const now = new Date().toISOString();
        await db.from('users').update({ username, last_active_at: now }).eq('id', (byDevice[0] as UserRow).id);
        return { success: true };
    }

    const now = new Date().toISOString();
    await db.from('users').insert({
        convex_id: crypto.randomUUID(),
        convex_created_at: now,
        created_at: now,
        username,
        device_id: deviceId,
        last_active_at: now,
        failed_attempts: 0,
        is_blocked: false,
    });
    return { success: true };
}

/** api.users.getUserByDevice — the user row bound to the device, if any. */
export async function getUserByDevice(db: SupabaseClient, deviceId: string): Promise<DbUser | null> {
    const { data } = await db.from('users').select('*').eq('device_id', deviceId).limit(1);
    if (!data || data.length === 0) return null;
    return mapUser(data[0] as UserRow);
}

