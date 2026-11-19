import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeagueInfo } from '@trophy-games/shared';

/** Port of Convex api.matches.getAllLeagues — used by storage.ts loadData. */
export async function getAllLeagues(db: SupabaseClient): Promise<LeagueInfo[]> {
    const { data } = await db
        .from('leagues')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
    return ((data ?? []) as Array<Record<string, unknown>>).map((l): LeagueInfo => ({
        id: typeof l.old_id === 'number' ? l.old_id : 0,
        name: String(l.name ?? ''),
        url: typeof l.url === 'string' ? l.url : undefined,
        logo: typeof l.logo === 'string' ? l.logo : undefined,
        type: typeof l.type === 'string' ? l.type : undefined,
        matchCount: typeof l.match_count === 'number' ? l.match_count : undefined,
        country: typeof l.country === 'string' ? l.country : undefined,
        countryId: typeof l.country_id === 'number' ? l.country_id : undefined,
        countryFlag: typeof l.country_flag === 'string' ? l.country_flag : undefined,
    }));
}
