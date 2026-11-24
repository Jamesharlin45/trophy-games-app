/**
 * Per-device id used for every authenticated request.
 *
 * Generated with expo-crypto as a random UUID and stored in
 * expo-secure-store (encrypted at rest on the device). The id is per-install:
 * it contains no application identifier or version string, so it stays stable
 * across app updates on the same device while remaining unique per install.
 */

import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'device_id';

/** Fallback id when expo-crypto cannot produce one (session-scoped). */
function fallbackId(): string {
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns the per-install id: read from secure storage when present,
 * otherwise generated with expo-crypto and stored when possible. */
export async function getDeviceId(): Promise<string> {
    try {
        const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
        if (typeof stored === 'string' && stored.trim() !== '') {
            return stored;
        }
    } catch {
        // SecureStore unavailable (e.g. dev web) — fall through to generate.
    }

    let id: string;
    try {
        id = randomUUID();
    } catch {
        id = fallbackId();
    }

    try {
        await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    } catch {
        // best effort: the id is still valid for this session
    }
    return id;
}
