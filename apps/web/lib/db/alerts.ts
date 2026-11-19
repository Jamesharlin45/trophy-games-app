import type { SupabaseClient } from '@supabase/supabase-js';

/** Port of the Convex `alerts` doc shape (camelCase) — the JSON the mobile
 * app reads from `api.alerts.getAlerts`. */
export interface DbAlert {
    _id: string;
    title: string;
    body: string;
    deviceId?: string;
    data?: unknown;
    readBy: string[];
    createdAt: string;
}

interface AlertRow {
    id: string;
    title: string;
    body: string;
    device_id: string | null;
    data: unknown;
    read_by: string[] | null;
    created_at: string;
}

function mapAlert(row: AlertRow): DbAlert {
    return {
        _id: row.id,
        title: row.title,
        body: row.body,
        deviceId: row.device_id ?? undefined,
        data: row.data ?? undefined,
        readBy: row.read_by ?? [],
        createdAt: row.created_at,
    };
}

/** api.alerts.getAlerts — newest first, capped at 50; global (no deviceId)
 * alerts are visible to everyone. */
export async function getAlerts(db: SupabaseClient, deviceId?: string): Promise<DbAlert[]> {
    const { data } = await db
        .from('alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
    return ((data ?? []) as AlertRow[])
        .filter((alert) => !alert.device_id || alert.device_id === deviceId)
        .map(mapAlert);
}

/** api.alerts.markRead — record the device as having read the alert. */
export async function markRead(db: SupabaseClient, alertId: string, deviceId: string): Promise<void> {
    const { data } = await db.from('alerts').select('id, read_by').eq('id', alertId).limit(1);
    if (!data || data.length === 0) return;
    const row = data[0] as Pick<AlertRow, 'id' | 'read_by'>;
    const readBy = Array.isArray(row.read_by) ? [...row.read_by] : [];
    if (!readBy.includes(deviceId)) {
        await db.from('alerts').update({ read_by: [...readBy, deviceId] }).eq('id', alertId);
    }
}

/** api.alerts.markAllRead — record the device as having read every alert
 * visible to it. */
export async function markAllRead(db: SupabaseClient, deviceId: string): Promise<void> {
    const { data } = await db.from('alerts').select('id, device_id, read_by');
    for (const alert of data ?? []) {
        const row = alert as Pick<AlertRow, 'id' | 'device_id' | 'read_by'>;
        if (!row.device_id || row.device_id === deviceId) {
            const readBy = Array.isArray(row.read_by) ? [...row.read_by] : [];
            if (!readBy.includes(deviceId)) {
                await db.from('alerts').update({ read_by: [...readBy, deviceId] }).eq('id', row.id);
            }
        }
    }
}

/** Port of the Convex `alerts.createAlert` mutation: insert the alert row,
 * then send the push notification (Convex scheduled sendPushNotification
 * right after the insert). */
export async function createAlert(
    db: SupabaseClient,
    input: { title: string; body: string; deviceId?: string; data?: unknown },
): Promise<void> {
    const now = new Date().toISOString();
    await db.from('alerts').insert({
        convex_id: crypto.randomUUID(),
        convex_created_at: now,
        device_id: input.deviceId ?? null,
        title: input.title,
        body: input.body,
        data: input.data ?? null,
        read_by: [],
        created_at: now,
    });
    await sendPushNotification(db, {
        title: input.title,
        body: input.body,
        deviceId: input.deviceId,
        data: input.data,
    });
}

/** Port of Convex `alerts.sendPushNotification`: POST to the Expo Push API
 * with every stored push token — all devices when no deviceId is given, or
 * the targeted device otherwise. */
async function sendPushNotification(
    db: SupabaseClient,
    args: { title: string; body: string; deviceId?: string; data?: unknown },
): Promise<void> {
    // Find devices to send to (Convex internalGetDevices: targeted device,
    // or every device when deviceId is omitted).
    let devices: Array<{ push_token: string | null }>;
    if (args.deviceId) {
        const { data } = await db.from('devices').select('push_token').eq('device_id', args.deviceId).limit(1);
        devices = (data ?? []) as Array<{ push_token: string | null }>;
    } else {
        const { data } = await db.from('devices').select('push_token');
        devices = (data ?? []) as Array<{ push_token: string | null }>;
    }

    const tokens = devices.filter((d) => d.push_token).map((d) => d.push_token as string);
    if (tokens.length === 0) return;

    const messages = tokens.map((to) => ({
        to,
        sound: 'default',
        title: args.title,
        body: args.body,
        data: args.data ?? {},
    }));

    try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(messages),
        });
        if (!response.ok) {
            console.error('Failed to send push notification', await response.text());
        }
    } catch (error) {
        console.error('Error sending push notifications', error);
    }
}
