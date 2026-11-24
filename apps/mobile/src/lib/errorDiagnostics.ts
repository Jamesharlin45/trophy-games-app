/**
 * Diagnostics storage for the last uncaught error.
 *
 * Written by the global JS error handler (ErrorUtils) and by ErrorBoundary
 * instances. Read by Settings → Diagnostics → "Last error" (copy/clear).
 * Never sent anywhere — AsyncStorage only. The stored payload contains no
 * personal data: message, stack, route, timestamp.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ErrorUtils } from 'react-native';
import { setStringAsync } from 'expo-clipboard';

export interface LastError {
    message: string;
    stack?: string;
    /** Screen/route at the time of the error (from the layout). */
    route: string;
    /** Unix epoch ms. */
    timestamp: number;
}

const STORAGE_KEY = '@trophy_games_last_error';

/** Current route, updated by the layout on navigation. */
let currentRoute = 'unknown';
export function setCurrentRoute(route: string): void {
    currentRoute = route || 'unknown';
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message || 'Unknown error';
    if (typeof error === 'string' && error.trim()) return error;
    if (error != null) {
        try {
            return String(error);
        } catch {
            // Unstringifiable values get a generic message.
        }
    }
    return 'Unknown error';
}

function errorStack(error: unknown): string | undefined {
    if (error instanceof Error && error.stack) return error.stack;
    return undefined;
}

/**
 * Clipboard-ready dump of the last error (message + first 15 stack lines).
 * Accepts any partial record so callers can build a quick one-off dump.
 */
export function formatLastErrorDetails(error: {
    message?: string;
    stack?: string;
    route?: string;
    timestamp?: number;
} | null): string {
    if (!error) return '';
    const stack = (error.stack ?? '').split('\n').slice(0, 15).join('\n').trim();
    return [error.message?.trim() ?? '', stack].filter(Boolean).join('\n');
}

/** Store the last error in AsyncStorage (best effort — never throws). */
export async function storeLastError(error: unknown): Promise<void> {
    try {
        const lastError: LastError = {
            message: errorMessage(error),
            stack: errorStack(error),
            route: currentRoute,
            timestamp: Date.now(),
        };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lastError));
    } catch {
        // Diagnostics must never take the app down.
    }
}

export async function readLastError(): Promise<LastError | null> {
    try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<LastError>;
        if (typeof parsed.message !== 'string' || !Number.isFinite(parsed.timestamp ?? NaN)) {
            return null;
        }
        return {
            message: parsed.message,
            stack: typeof parsed.stack === 'string' ? parsed.stack : undefined,
            route: typeof parsed.route === 'string' ? parsed.route : 'unknown',
            timestamp: parsed.timestamp as number,
        };
    } catch {
        return null;
    }
}

export async function clearLastError(): Promise<void> {
    try {
        await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore — clearing diagnostics is best-effort.
    }
}

/**
 * Install the global JS error handler: stores the last uncaught error in
 * AsyncStorage and shows it in Settings → Diagnostics → "Last error".
 */
export function installGlobalErrorHandler(): void {
    ErrorUtils.setGlobalHandler((error) => {
        void storeLastError(error);
    });
}

/** Copy a LastError to the clipboard (message + first 15 stack lines). */
export async function copyLastError(error: LastError | null): Promise<void> {
    if (!error) return;
    const details = formatLastErrorDetails(error);
    if (details) await setStringAsync(details);
}
