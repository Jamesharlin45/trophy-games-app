/** Reusable jest mock factories for the render-test suites. */

/* eslint-disable @typescript-eslint/no-explicit-any */

export function createRouterMock() {
    const React = require('react');
    const { View } = require('react-native');
    const { env } = require('./testEnv');
    const router = {
        push: (...args: unknown[]) => env.routerPush(...args),
        replace: jest.fn(),
        back: jest.fn(),
        dismiss: jest.fn(),
        navigate: jest.fn(),
    };
    const Navigator = ({ children, ...props }: any) => React.createElement(View, props, children);
    const Tabs = Object.assign(Navigator, { Screen: () => null });
    const Stack = Object.assign(Navigator, { Screen: () => null });
    return {
        __esModule: true,
        router,
        Tabs,
        Stack,
        useRouter: () => router,
        usePathname: () => '/(tabs)/index',
        useLocalSearchParams: () => env.route,
        useFocusEffect: (callback: () => void | (() => void)) => {
            React.useEffect(() => {
                if (env.focusEnabled) return callback();
                return undefined;
            }, [callback]);
        },
    };
}

export function createStorageMock() {
    const { env } = require('./testEnv');
    return {
        __esModule: true,
        default: {
            getItem: async (key: string) => env.storage.get(key) ?? null,
            setItem: async (key: string, value: string) => { env.storage.set(key, value); },
            removeItem: async (key: string) => { env.storage.delete(key); },
            multiRemove: async (keys: string[]) => { keys.forEach((k) => env.storage.delete(k)); },
            multiGet: async (keys: string[]) => keys.map((k) => [k, env.storage.get(k) ?? null]),
            getAllKeys: async () => Array.from(env.storage.keys()),
            clear: async () => { env.storage.clear(); },
        },
    };
}

export function createApiMock(actual: any) {
    const { env, settle } = require('./testEnv') as typeof import('./testEnv');
    const diagnostics = require('../../src/lib/connectionDiagnostics') as typeof import('../../src/lib/connectionDiagnostics');
    diagnostics.setApiHost(env.apiBaseUrl);
    const record = (path: string, status: number, count: number) => {
        env.lastRequestPath = path;
        env.lastStatus = status;
        env.lastMatchesCount = count;
        env.lastRequestAt = Date.now();
        diagnostics.recordApiRequest({ path: path.split('?')[0], status, body: new Array(count) });
    };
    return {
        ...actual,
        get API_BASE_URL() { return env.apiBaseUrl; },
        get isApiConfigured() { return env.apiBaseUrl.length > 0; },
        api: {
            ...actual.api,
            matches: {
                ...actual.api.matches,
                byTypeAndDate: async (tier: string, date: string, limit?: number) => {
                    const list = env.matchesByType[tier] ?? [];
                    record(`/api/app/matches/by-type-and-date?matchType=${tier}&date=${date}&limit=${limit ?? ''}`, 200, list.length);
                    return settle(env.matchesMode, list, env.delayMs);
                },
                byDate: async (date: string) => {
                    record(`/api/app/matches/by-date?date=${date}`, 200, 0);
                    return settle(env.matchesMode, [], env.delayMs);
                },
                all: async (limit?: number) => {
                    record(`/api/app/matches/all?limit=${limit ?? ''}`, 200, 0);
                    return settle(env.matchesMode, [], env.delayMs);
                },
                byId: async (matchId: string) => {
                    record(`/api/app/matches/by-id?matchId=${matchId}`, 200, env.byId ? 1 : 0);
                    return settle(env.matchesMode, env.byId, env.delayMs);
                },
                history: async (limit?: number, date?: string) => {
                    const result = env.history;
                    record(`/api/app/matches/history?limit=${limit ?? ''}&date=${date ?? ''}`, 200, result.matches.length);
                    return settle(env.matchesMode, result, env.delayMs);
                },
            },
            users: {
                ...actual.api.users,
                byDevice: async () => settle(env.userMode, env.username ? { username: env.username, _id: 'u1', deviceId: 'd1', createdAt: '' } : null, env.delayMs),
                register: async () => ({ success: true }),
                checkUsername: async () => ({ available: true }),
            },
            tokens: {
                ...actual.api.tokens,
                getMembershipStatus: async (_deviceId: string, type: 'vip' | 'paid') =>
                    settle(env.membershipMode, env.membership[type] ?? { status: 'none' }, env.delayMs),
                requestMembership: async () => ({ success: true, requestId: 'r1' }),
                createMembershipRequest: async () => ({ success: true, requestId: 'r1' }),
                claimToken: async () => ({ success: true, type: 'vip' }),
                verifyToken: async () => ({ valid: true, type: 'vip' }),
            },
            purchases: {
                ...actual.api.purchases,
                recordPurchase: async () => ({ success: true, alreadyRecorded: false, token: 't', tier: 'vip', expiresAt: '' }),
                getActiveSubscription: async () => null,
                setEmail: async () => ({ success: true, action: 'inserted' }),
            },
            alerts: { ...actual.api.alerts, getAlerts: async () => [], markRead: async () => null, markAllRead: async () => null },
            devices: { ...actual.api.devices, registerPushToken: async () => null },
            teamColor: async () => ({ hex: '#000000' }),
        },
    };
}

export function createIapMock() {
    const { env, settle } = require('./testEnv') as typeof import('./testEnv');
    const products = [
        { id: 'com.khanblair.trophygames.vip.weekly', title: 'VIP WEEKLY', displayPrice: 'KSh 200', price: '200' },
        { id: 'com.khanblair.trophygames.vip.monthly', title: 'VIP MONTHLY', displayPrice: 'KSh 500', price: '500' },
        { id: 'com.khanblair.trophygames.paid.monthly', title: 'PAID MONTHLY', displayPrice: 'KSh 300', price: '300' },
    ];
    return {
        useIap: () => ({
            products: env.billingMode === 'never' ? [] : products,
            activeSubscription: null,
            loading: env.billingMode === 'slow' || env.billingMode === 'never',
            error: env.billingMode === 'reject' ? 'Billing unavailable' : null,
            purchase: async () => settle(env.billingMode, { success: false, reason: 'Cancelled' }, env.delayMs),
            refresh: async () => {},
        }),
    };
}

export function createLucideMock() {
    const React = require('react');
    const { Text } = require('react-native');
    const Icon = ({ name, size, color }: any) =>
        React.createElement(Text, { style: { fontSize: size ?? 12, color } }, name);
    return new Proxy(
        { __esModule: true, default: Icon, Icon },
        { get: (target: any, prop: string) => (prop in target ? target[prop] : Icon) },
    );
}

export function createVectorIconsMock() {
    const React = require('react');
    const { Text } = require('react-native');
    const Icon = ({ name, size, color }: any) =>
        React.createElement(Text, { style: { fontSize: size ?? 12, color } }, name);
    return { __esModule: true, Ionicons: Icon, MaterialIcons: Icon };
}
