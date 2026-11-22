import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { LEGACY_DEVICE_PREFIX } from '@/lib/device-id';

export const dynamic = 'force-dynamic';

export interface LegacyStats {
    tokens: number;
    purchases: number;
    requests: number;
    users: number;
}

type TableName = 'access_tokens' | 'purchases' | 'membership_requests' | 'users';

/** GET /api/admin/legacy-stats — how many rows still use shared legacy ids.
 * Admin auth is enforced by the /api/admin matcher in proxy.ts. */
export async function GET() {
    const db = createDb();
    if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    try {
        const tables: Array<{ key: keyof LegacyStats; table: TableName }> = [
            { key: 'tokens', table: 'access_tokens' },
            { key: 'purchases', table: 'purchases' },
            { key: 'requests', table: 'membership_requests' },
            { key: 'users', table: 'users' },
        ];
        const counts = await Promise.all(
            tables.map(async ({ table }) => {
                const { count, error } = await db
                    .from(table)
                    .select('id', { count: 'exact', head: true })
                    .like('device_id', `${LEGACY_DEVICE_PREFIX}%`);
                if (error) throw new Error(error.message);
                return count ?? 0;
            }),
        );
        const stats: LegacyStats = {
            tokens: counts[0],
            purchases: counts[1],
            requests: counts[2],
            users: counts[3],
        };
        return NextResponse.json(stats);
    } catch (error) {
        console.error('[API] Legacy stats failed:', error instanceof Error ? error.message : 'unknown error');
        return NextResponse.json({ error: 'Failed to load legacy counts' }, { status: 500 });
    }
}
