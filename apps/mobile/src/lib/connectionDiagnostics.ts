/**
 * In-memory diagnostics for the most recent API request and membership
 * answer. Kept out of the UI: nothing is persisted or transmitted.
 */

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

