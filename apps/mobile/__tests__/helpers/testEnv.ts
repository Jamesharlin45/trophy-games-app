/** Mutable state shared by the module mocks in the render-test suites. */

import type { MatchData } from '@trophy-games/shared';
import type { HistoryResponse } from '../../src/api/client';

export type LoadMode = 'resolve' | 'slow' | 'reject' | 'never';

export interface TestEnv {
    /** Default mode for match-list endpoints. */
    matchesMode: LoadMode;
    /** Default mode for membership/user/billing endpoints. */
    membershipMode: LoadMode;
    billingMode: LoadMode;
    userMode: LoadMode;
    /** Delay used by 'slow' mode (ms). */
    delayMs: number;
    /** Matches returned by GET /matches/by-type-and-date, keyed by tier. */
    matchesByType: Record<string, MatchData[]>;
    history: HistoryResponse;
    byId: MatchData | null;
    /** Status returned by GET /tokens/get-membership-status. */
    membership: Record<'vip' | 'paid', { status: string } | null>;
    username: string | null;
    /** Route params for expo-router mocks. */
    route: { id?: string; matchData?: string; plan?: string };
    focusEnabled: boolean;
    routerPush: (...args: unknown[]) => void;
    /** Simple in-memory AsyncStorage used by providers and diagnostics. */
    storage: Map<string, string>;
    apiBaseUrl: string;
    lastRequestPath: string;
    lastStatus: number | null;
    lastMatchesCount: number;
    lastRequestAt: number | null;
}

function localDateKey(date: Date): string {
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
}

export function todayKey(): string {
    return localDateKey(new Date());
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Resolve/reject/never-settle according to a mode, for timeout tests. */
export async function settle<T>(mode: LoadMode, value: T, ms = 0): Promise<T> {
    if (mode === 'never') return new Promise<T>(() => {});
    if (ms > 0) await delay(ms);
    if (mode === 'reject') throw new Error('Simulated network failure');
    return value;
}

export const env: TestEnv = {
    matchesMode: 'resolve',
    membershipMode: 'resolve',
    billingMode: 'resolve',
    userMode: 'resolve',
    delayMs: 0,
    matchesByType: { free: [], paid: [], vip: [], unassigned: [] },
    history: { matches: [], strikeRate: 0, strikeRate30d: 0 },
    byId: null,
    membership: { vip: null, paid: null },
    username: 'test-user',
    route: {},
    focusEnabled: true,
    routerPush: () => {},
    storage: new Map<string, string>(),
    apiBaseUrl: 'https://api.example.test',
    lastRequestPath: '',
    lastStatus: null,
    lastMatchesCount: 0,
    lastRequestAt: null,
};

export function resetEnv(): void {
    env.matchesMode = 'resolve';
    env.membershipMode = 'resolve';
    env.billingMode = 'resolve';
    env.userMode = 'resolve';
    env.delayMs = 0;
    env.matchesByType = { free: [], paid: [], vip: [], unassigned: [] };
    env.history = { matches: [], strikeRate: 0, strikeRate30d: 0 };
    env.byId = null;
    env.membership = { vip: null, paid: null };
    env.username = 'test-user';
    env.route = {};
    env.focusEnabled = true;
    env.routerPush = () => {};
    env.storage.clear();
    env.apiBaseUrl = 'https://api.example.test';
    env.lastRequestPath = '';
    env.lastStatus = null;
    env.lastMatchesCount = 0;
    env.lastRequestAt = null;
}
