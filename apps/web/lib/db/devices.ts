import type { SupabaseClient } from '@supabase/supabase-js';

/** Port of the Convex `devices` table access (packages/backend/convex/devices.ts,
 * the registerPushToken mutation). */

/** api.devices.registerPushToken — insert or update by device_id. */
export async function registerPushToken(
    db: SupabaseClient,
    input: { deviceId: string; pushToken: string },
): Promise<void> {
    const { data } = await db.from('devices').select('id').eq('device_id', input.deviceId).limit(1);
    if (data && data.length > 0) {
        await db
            .from('devices')
            .update({ push_token: input.pushToken, last_active_at: new Date().toISOString() })
            .eq('id', data[0].id);
    } else {
        const { error } = await db.from('devices').insert({
            convex_id: crypto.randomUUID(),
            device_id: input.deviceId,
            push_token: input.pushToken,
            last_active_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
    }
}
