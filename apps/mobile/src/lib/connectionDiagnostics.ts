/**
 * In-memory diagnostics for the most recent API request and membership
 * answer. Settings → Diagnostics shows a host only — never a full URL, query
 * string, token, password or API key. Nothing is persisted or transmitted.
 */

import { setStringAsync } from 'expo-clipboard';

export interface ConnectionDiagnostics {
    /** Origin host from EXPO_PUBLIC_API_URL, e.g. trophy-games-app.vercel.app. */
    host: string;
    /** Last path (no query string), e.g. /api/app/matches/by-type-and-date. */
    lastPath: string;
    status: number | null;
    /** Unix epoch ms of the last request. */
    at: number | null;
    /** Number of matches in the last array response, when applicable. */
    matchesCount: number | null;
    /** Human-readable VIP/Paid membership snapshot. */
    membershipStatus: string;
}

let state: ConnectionDiagnostics = {
    host: '',
    lastPath: 'none yet',
    status: null,
    at: null,
    matchesCount: null,
    membershipStatus: 'unknown',
};

export function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return '';
    }
}

export function setApiHost(url: string): void {
    const host = hostOf(url);
    if (host) state = { ...state, host };
}

export function recordApiRequest(input: {
    path: string;
    status: number;
    body?: unknown;
    at?: number;
}): void {
    const matchesCount = Array.isArray(input.body) ? input.body.length : state.matchesCount;
    state = {
        ...state,
        lastPath: input.path,
        status: input.status,
        at: input.at ?? Date.now(),
        matchesCount,
    };
}

export function recordMembershipStatus(tier: 'vip' | 'paid', status: string | undefined): void {
    const label = status || 'none';
    const key = tier === 'vip' ? 'vip' : 'paid';
    const membership = state.membershipStatus;
    const parts = membership === 'unknown' || membership === 'none' ? [] : membership.split(', ');
    const next = parts.filter((part) => !part.startsWith(`${key}:`));
    next.push(`${key}: ${label}`);
    state = { ...state, membershipStatus: next.sort().join(', ') };
}

export function getConnectionDiagnostics(): ConnectionDiagnostics {
    return { ...state };
}

/** Stable, non-reversible support code derived from a device id. */
export function deviceCode(deviceId: string): string {
    let hash = 2166136261;
    for (let i = 0; i < deviceId.length; i++) {
        hash ^= deviceId.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
    return `TG-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export function formatConnectionDiagnostics(input: ConnectionDiagnostics, extra: {
    version: string;
    build: string;
    deviceCode: string;
}): string {
    return [
        `Host: ${input.host || 'not configured'}`,
        `Last path: ${input.lastPath}`,
        `Status: ${input.status ?? 'none'}`,
        `Time: ${input.at ? new Date(input.at).toLocaleString() : 'none'}`,
        `Matches: ${input.matchesCount ?? 0}`,
        `Membership: ${input.membershipStatus}`,
        `App: ${extra.version} (${extra.build})`,
        `Device: ${extra.deviceCode}`,
    ].join('\n');
}

export async function copyConnectionDiagnostics(text: string): Promise<void> {
    try {
        await setStringAsync(text);
    } catch {
        // Clipboard is best-effort; never fail the Settings screen.
    }
}
