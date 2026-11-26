/**
 * Crash reporter — global JS error reporting for the mobile app.
 *
 * - Installs `ErrorUtils.setGlobalHandler`, chaining the previous handler
 *   so any earlier behavior is preserved.
 * - On any JS error: stores `{ message, stack, time }` in AsyncStorage under
 *   the `last_crash` key and POSTs it to `${EXPO_PUBLIC_API_URL}/api/app/client-error`
 *   (fire and forget, 3 s timeout). Reporting never throws.
 * - On the next start: sends any stored crash and clears it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ErrorUtils } from 'react-native';

const LAST_CRASH_KEY = 'last_crash';
const CRASH_REPORT_TIMEOUT_MS = 3000;
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

interface StoredCrash {
    message: string;
    stack?: string | null;
    time: string;
}

function toStoredCrash(error: unknown): StoredCrash {
    let message = 'Unknown error';
    try {
        message = error instanceof Error ? error.message : String(error);
    } catch {
        // Exotic values that cannot be stringified still get a safe message.
    }
    return {
        message,
        stack: error instanceof Error ? error.stack ?? null : null,
        time: new Date().toISOString(),
    };
}

async function sendCrashReport(crash: StoredCrash): Promise<void> {
    if (!API_BASE_URL) return;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CRASH_REPORT_TIMEOUT_MS);
        try {
            await fetch(`${API_BASE_URL}/api/app/client-error`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(crash),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        // Reporting is best-effort — never throw to callers.
    }
}

async function flushStoredCrash(): Promise<void> {
    try {
        const raw = await AsyncStorage.getItem(LAST_CRASH_KEY);
        if (!raw) return;
        // Clear first so a failing send doesn't loop forever on the next start.
        await AsyncStorage.removeItem(LAST_CRASH_KEY);
        const crash: StoredCrash = JSON.parse(raw);
        await sendCrashReport(crash);
    } catch {
        // Best-effort flush; ignore AsyncStorage/parse failures.
    }
}

function installCrashReporter(): void {
    try {
        const previousHandler = ErrorUtils.getGlobalHandler();
        ErrorUtils.setGlobalHandler((error, isFatal) => {
            // Chain the previous handler first, preserving earlier behavior.
            // A broken earlier handler must not stop crash recording.
            try {
                previousHandler?.(error, isFatal);
            } catch {
                // Ignore — reporting below still runs.
            }

            const crash = toStoredCrash(error);
            void (async () => {
                try {
                    await AsyncStorage.setItem(LAST_CRASH_KEY, JSON.stringify(crash));
                } catch {
                    // AsyncStorage unavailable — nothing more to do.
                }
                await sendCrashReport(crash);
            })();
        });
    } catch {
        // ErrorUtils unavailable (e.g. tests) — crash reporting is optional.
    }
}

installCrashReporter();
void flushStoredCrash();
