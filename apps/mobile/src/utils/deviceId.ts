/**
 * Per-device id used for every authenticated request.
 *
 * Prefers the Android id (`Application.getAndroidId()`) when available,
 * falling back to a UUID stored in AsyncStorage when the native id is
 * unavailable or empty (e.g. off Android or in the emulator).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';

const DEVICE_ID_KEY = '@trophy_games_device_id';

function generateId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // Older Hermes without crypto — fall through to the manual id.
    }
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns the per-device id: `${applicationId}_${androidId}` on Android, or
 * a persisted UUID when that is unavailable.
 */
export async function getDeviceId(): Promise<string> {
    try {
        const applicationId = Application.applicationId;
        if (applicationId) {
            const androidId = Application.getAndroidId();
            if (androidId) {
                return `${applicationId}_${androidId}`;
            }
        }
    } catch {
        // getAndroidId is unavailable off Android — use the stored fallback.
    }

    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;

    const id = generateId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    return id;
}
