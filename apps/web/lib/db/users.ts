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

