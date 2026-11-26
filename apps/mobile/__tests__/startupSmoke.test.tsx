/**
 * Startup smoke tests.
 *
 * Renders the real root layout (`src/app/_layout.tsx`) inside its providers
 * with every native/Expo module mocked. Each scenario represents a way a real
 * device can misbehave during launch (navigation-bar rejection, secure storage
 * failure, corrupted preferences, billing unavailable, push registration
 * failure, offline API) and asserts that:
 *
 *  - the app tree still renders, and
 *  - no error escapes as an unhandled promise rejection.
 *
 * What these tests cannot prove: they run against mocked native modules, so
 * they cannot detect a crash caused by native code (a missing symbol, a bad
 * Android manifest entry, a native-only exception). Those still require a
 * release build on a real device.
 */

import React from 'react';
import { Platform } from 'react-native';
import { act, render } from '@testing-library/react-native';

import RootLayout from '../src/app/_layout';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CacheManager } from '../src/utils/cache';
import { readLastError } from '../src/lib/errorDiagnostics';

// ---------------------------------------------------------------------------
// Controllable module mocks
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => {
    const ReactMock = require('react');
    const { View } = require('react-native');
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        dismiss: jest.fn(),
        navigate: jest.fn(),
    };
    const Stack = () => ReactMock.createElement(View, { testID: 'root-stack' });
    Stack.Screen = () => null;
    return {
        __esModule: true,
        router,
        Stack,
        useRouter: () => router,
        usePathname: () => '/',
        useLocalSearchParams: () => ({}),
        useFocusEffect: (callback: () => void | (() => void)) => {
            ReactMock.useEffect(() => callback(), [callback]);
        },
    };
});

jest.mock('expo-font', () => ({
    __esModule: true,
    useFonts: () => [true],
}));

jest.mock('expo-splash-screen', () => ({
    __esModule: true,
    preventAutoHideAsync: jest.fn(async () => true),
    hideAsync: jest.fn(async () => true),
}));

jest.mock('expo-status-bar', () => {
    const ReactMock = require('react');
    return { __esModule: true, StatusBar: () => ReactMock.createElement(ReactMock.Fragment, null) };
});

jest.mock('expo-navigation-bar', () => {
    const state: { methods: Record<string, unknown> } = { methods: {} };
    return {
        __esModule: true,
        __configure(next: { methods?: Record<string, unknown> }) {
            if (next.methods) state.methods = next.methods;
        },
        get setBackgroundColorAsync() {
            return state.methods.setBackgroundColorAsync;
        },
        get setBorderColorAsync() {
            return state.methods.setBorderColorAsync;
        },
        get setButtonStyleAsync() {
            return state.methods.setButtonStyleAsync;
        },
    };
});

jest.mock('react-native-is-edge-to-edge', () => {
    const state = { edgeToEdge: true };
    return {
        __configure(next: { edgeToEdge?: boolean }) {
            if (typeof next.edgeToEdge === 'boolean') state.edgeToEdge = next.edgeToEdge;
        },
        isEdgeToEdge: () => state.edgeToEdge,
    };
});

jest.mock('@react-native-async-storage/async-storage', () => {
    const store = new Map<string, string>();
    let failing = false;
    const guard = <T,>(run: () => T): Promise<T> =>
        failing ? Promise.reject(new Error('AsyncStorage unavailable')) : Promise.resolve(run());
    return {
        __reset() {
            store.clear();
            failing = false;
        },
        __seed(entries: Record<string, string>) {
            for (const [key, value] of Object.entries(entries)) store.set(key, value);
        },
        __setFailing(value: boolean) {
            failing = value;
        },
        getItem: (key: string) => guard(() => (store.has(key) ? store.get(key)! : null)),
        setItem: (key: string, value: string) => guard(() => { store.set(key, value); }),
        removeItem: (key: string) => guard(() => { store.delete(key); }),
        multiRemove: (keys: string[]) => guard(() => { keys.forEach((key) => store.delete(key)); }),
        multiGet: (keys: string[]) => guard(() => keys.map((key) => [key, store.has(key) ? store.get(key)! : null])),
        getAllKeys: () => guard(() => Array.from(store.keys())),
        clear: () => guard(() => { store.clear(); }),
    };
});

jest.mock('expo-secure-store', () => {
    const state = {
        get: async (): Promise<string | null> => null,
        set: async (): Promise<void> => undefined,
    };
    return {
        __esModule: true,
        __configure(next: Partial<typeof state>) {
            Object.assign(state, next);
        },
        getItemAsync: () => state.get(),
        setItemAsync: () => state.set(),
    };
});

jest.mock('expo-crypto', () => ({
    __esModule: true,
    randomUUID: () => '00000000-0000-4000-8000-000000000000',
}));

jest.mock('expo-localization', () => {
    const state: { locales: Array<{ languageCode?: string }> } = {
        locales: [{ languageCode: 'en' }],
    };
    return {
        __esModule: true,
        __configure(next: { locales?: Array<{ languageCode?: string }> }) {
            if (next.locales) state.locales = next.locales;
        },
        getLocales: () => state.locales,
    };
});

jest.mock('expo-clipboard', () => ({
    __esModule: true,
    setStringAsync: jest.fn(async () => true),
    getStringAsync: jest.fn(async () => ''),
}));

jest.mock('expo-device', () => {
    const state = { isDevice: true };
    return {
        __esModule: true,
        __configure(next: { isDevice?: boolean }) {
            if (typeof next.isDevice === 'boolean') state.isDevice = next.isDevice;
        },
        get isDevice() {
            return state.isDevice;
        },
    };
});

jest.mock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));

jest.mock('expo-notifications', () => {
    const state = {
        permission: 'granted' as string,
        token: { data: 'ExponentPushToken[test]' } as { data: string } | null,
        tokenError: false,
        channelError: false,
        listenerError: false,
    };
    const noopSubscription = { remove: jest.fn() };
    return {
        __esModule: true,
        __configure(next: Partial<typeof state>) {
            Object.assign(state, next);
        },
        AndroidImportance: { MAX: 5 },
        setNotificationHandler: jest.fn(() => undefined),
        setNotificationChannelAsync: jest.fn(async () => {
            if (state.channelError) throw new Error('channel unavailable');
        }),
        getPermissionsAsync: jest.fn(async () => ({ status: state.permission })),
        requestPermissionsAsync: jest.fn(async () => ({ status: state.permission })),
        getExpoPushTokenAsync: jest.fn(async () => {
            if (state.tokenError) throw new Error('push token unavailable');
            return state.token;
        }),
        addNotificationReceivedListener: jest.fn(() => {
            if (state.listenerError) throw new Error('listener unavailable');
            return noopSubscription;
        }),
        addNotificationResponseReceivedListener: jest.fn(() => noopSubscription),
    };
});

jest.mock('react-native-iap', () => {
    const state = { available: true, connected: true };
    const configure = (next: { available?: boolean; connected?: boolean }) => {
        Object.assign(state, next);
    };
    return new Proxy(
        {},
        {
            get(_target, property: string) {
                if (property === '__esModule') return true;
                if (property === '__configure') return configure;
                if (!state.available) return undefined;
                if (property === 'useIAP') {
                    return () => ({
                        connected: state.connected,
                        products: [],
                        subscriptions: [],
                        fetchProducts: jest.fn(async () => undefined),
                        getAvailablePurchases: jest.fn(async () => undefined),
                        requestPurchase: jest.fn(async () => undefined),
                    });
                }
                if (property === 'initConnection') return jest.fn(async () => false);
                if (property === 'endConnection') return jest.fn(async () => true);
                if (property === 'getAvailablePurchases') return jest.fn(async () => []);
                if (property === 'fetchProducts') return jest.fn(async () => []);
                if (property === 'finishTransaction') return jest.fn(async () => undefined);
                return undefined;
            },
        },
    );
});

jest.mock('react-native-safe-area-context', () => {
    const ReactMock = require('react');
    const { View } = require('react-native');
    const SafeAreaProvider = ({ children }: { children: React.ReactNode }) =>
        ReactMock.createElement(View, null, children);
    const SafeAreaView = ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactMock.createElement(View, props, children);
    return {
        __esModule: true,
        SafeAreaProvider,
        SafeAreaView,
        useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
        SafeAreaInsetsContext: ReactMock.createContext({ top: 0, right: 0, bottom: 0, left: 0 }),
    };
});

jest.mock('@react-navigation/native', () => {
    const ReactMock = require('react');
    return {
        __esModule: true,
        DarkTheme: { dark: true },
        DefaultTheme: { dark: false },
        ThemeProvider: ({ children }: { children: React.ReactNode }) =>
            ReactMock.createElement(ReactMock.Fragment, null, children),
    };
});

jest.mock('react-native-reanimated', () => {
    const { View, Text, Image, ScrollView } = require('react-native');
    const Animated = { View, Text, Image, ScrollView };
    return {
        __esModule: true,
        default: Animated,
        ...Animated,
        useSharedValue: (value: unknown) => ({ value }),
        useAnimatedStyle: () => ({}),
        useReducedMotion: () => true,
        withTiming: (value: unknown) => value,
        withDelay: (_delay: number, value: unknown) => value,
        runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
        Easing: { out: (value: unknown) => value, cubic: (value: unknown) => value, linear: (value: unknown) => value },
    };
});

jest.mock('@expo/vector-icons', () => {
    const ReactMock = require('react');
    const { Text } = require('react-native');
    const Icon = (props: { name?: string; size?: number; color?: string }) =>
        ReactMock.createElement(
            Text,
            { style: { fontSize: props.size ?? 12, color: props.color } },
            props.name ?? 'icon',
        );
    return { __esModule: true, Ionicons: Icon };
});

jest.mock('lucide-react-native', () => {
    const ReactMock = require('react');
    const { Text } = require('react-native');
    const Icon = (props: { size?: number; color?: string }) =>
        ReactMock.createElement(Text, { style: { fontSize: props.size ?? 12, color: props.color } }, 'icon');
    return new Proxy(
        {},
        {
            get() {
                return Icon;
            },
        },
    );
});

// Render the splash once, then immediately hand control to the app.
jest.mock('../src/components/SplashAnim', () => {
    const ReactMock = require('react');
    const { View } = require('react-native');
    return function MockSplashAnim({ onDone }: { onDone: () => void }) {
        ReactMock.useEffect(() => {
            onDone();
        }, [onDone]);
        return ReactMock.createElement(View, { testID: 'splash-anim' });
    };
});

jest.mock('../src/api/client', () => {
    const state = { offline: false, pushRegisterError: false };
    const ok = <T,>(value: T): Promise<T> =>
        state.offline ? Promise.reject(new Error('network offline')) : Promise.resolve(value);
    return {
        __esModule: true,
        __configure(next: { offline?: boolean; pushRegisterError?: boolean }) {
            Object.assign(state, next);
        },
        api: {
            users: {
                byDevice: () => ok(null),
            },
            tokens: {
                getMembershipStatus: () => ok({ status: 'none' }),
                createMembershipRequest: () => ok({ success: true }),
                claimToken: () => ok({ success: true }),
            },
            purchases: {
                getActiveSubscription: () => ok(null),
                recordPurchase: () => ok({ success: true, tier: 'vip', expiresAt: undefined }),
                setEmail: () => ok({ success: true }),
            },
            alerts: {
                getAlerts: () => ok([]),
            },
            devices: {
                registerPushToken: () =>
                    state.pushRegisterError
                        ? Promise.reject(new Error('push registration failed'))
                        : ok({ success: true }),
            },
        },
        toApiError: (error: unknown) => error,
        ApiError: class ApiError extends Error {},
    };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const asyncStorageMock = AsyncStorage as unknown as {
    __reset: () => void;
    __seed: (entries: Record<string, string>) => void;
    __setFailing: (value: boolean) => void;
};
const navigationBarMock = require('expo-navigation-bar');
const edgeToEdgeMock = require('react-native-is-edge-to-edge');
const secureStoreMock = require('expo-secure-store');
const notificationsMock = require('expo-notifications');
const iapMock = require('react-native-iap');
const apiMock = require('../src/api/client');
const deviceMock = require('expo-device');

const unhandledRejections: unknown[] = [];

function onUnhandledRejection(reason: unknown): void {
    unhandledRejections.push(reason);
}

async function flush(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

async function renderRoot() {
    const result = await render(<RootLayout />);
    await flush();
    return result;
}

function navMethods() {
    return {
        setBackgroundColorAsync: jest.fn(async () => undefined),
        setBorderColorAsync: jest.fn(async () => undefined),
        setButtonStyleAsync: jest.fn(async () => undefined),
    };
}

beforeAll(() => {
    process.on('unhandledRejection', onUnhandledRejection);
    Object.defineProperty(Platform, 'OS', {
        configurable: true,
        get: () => 'android',
    });
});

afterAll(() => {
    process.off('unhandledRejection', onUnhandledRejection);
});

beforeEach(() => {
    jest.clearAllMocks();
    unhandledRejections.length = 0;
    asyncStorageMock.__reset();
    edgeToEdgeMock.__configure({ edgeToEdge: true });
    navigationBarMock.__configure({ methods: navMethods() });
    secureStoreMock.__configure({
        get: async () => null,
        set: async () => undefined,
    });
    notificationsMock.__configure({
        permission: 'granted',
        token: { data: 'ExponentPushToken[test]' },
        tokenError: false,
        channelError: false,
        listenerError: false,
    });
    deviceMock.__configure({ isDevice: true });
    iapMock.__configure({ available: true, connected: true });
    apiMock.__configure({ offline: false, pushRegisterError: false });
});

afterEach(async () => {
    // Give any trailing best-effort promises a chance to settle.
    await flush();
    expect(unhandledRejections).toEqual([]);
});

describe('startup smoke', () => {
    it('renders the root layout and app tree with healthy modules', async () => {
        const result = await renderRoot();
        expect(result.queryByTestId('root-stack')).not.toBeNull();
        expect(result.toJSON()).toBeTruthy();
    });

    it('survives a rejecting navigation bar with edge-to-edge enabled', async () => {
        const methods = navMethods();
        methods.setButtonStyleAsync.mockImplementation(async () => {
            throw new Error('button style unsupported');
        });
        navigationBarMock.__configure({ methods });
        edgeToEdgeMock.__configure({ edgeToEdge: true });

        const result = await renderRoot();

        expect(result.queryByTestId('root-stack')).not.toBeNull();
        expect(methods.setButtonStyleAsync).toHaveBeenCalled();
        // Background/border are unsupported with edge-to-edge and must be skipped.
        expect(methods.setBackgroundColorAsync).not.toHaveBeenCalled();
        expect(methods.setBorderColorAsync).not.toHaveBeenCalled();
    });

    it('survives every navigation bar call rejecting without edge-to-edge', async () => {
        const methods = navMethods();
        methods.setBackgroundColorAsync.mockImplementation(async () => {
            throw new Error('background unsupported');
        });
        methods.setBorderColorAsync.mockImplementation(async () => {
            throw new Error('border unsupported');
        });
        methods.setButtonStyleAsync.mockImplementation(async () => {
            throw new Error('button style unsupported');
        });
        navigationBarMock.__configure({ methods });
        edgeToEdgeMock.__configure({ edgeToEdge: false });

        const result = await renderRoot();

        expect(result.queryByTestId('root-stack')).not.toBeNull();
        expect(methods.setBackgroundColorAsync).toHaveBeenCalled();
        expect(methods.setBorderColorAsync).toHaveBeenCalled();
        expect(methods.setButtonStyleAsync).toHaveBeenCalled();
    });

    it('survives SecureStore throwing while reading and writing the device id', async () => {
        secureStoreMock.__configure({
            get: async () => {
                throw new Error('keystore unavailable');
            },
            set: async () => {
                throw new Error('keystore unavailable');
            },
        });

        const result = await renderRoot();
        expect(result.queryByTestId('root-stack')).not.toBeNull();
    });

    it('falls back from corrupted AsyncStorage values for every stored key', async () => {
        asyncStorageMock.__seed({
            'user-theme': '{not valid json',
            'user-accent': '999',
            'user-language': 'xx',
            '@trophy_games_username': '{"user":"someone"}',
            '@trophy_games_signed_out': 'not-a-boolean',
            '@trophy_games_request_email': '["not","an","email"]',
            '@trophy_games_last_error': '{broken',
            last_crash: 'also not json',
            '@bet_titan_cache_membership': '{"data":{"status":"active"},"timestamp":"yesterday","ttl":null}',
            '@bet_titan_cache_matches': 'null',
            'team-color:https://example.test/crest.png': 'not-a-hex-colour',
        });

        const result = await renderRoot();

        expect(result.queryByTestId('root-stack')).not.toBeNull();
        // The cache/diagnostics readers treat malformed entries as a miss.
        await expect(CacheManager.get('membership')).resolves.toBeNull();
        await expect(CacheManager.get('matches')).resolves.toBeNull();
        await expect(readLastError()).resolves.toBeNull();
    });

    it('survives AsyncStorage rejecting every operation', async () => {
        asyncStorageMock.__setFailing(true);

        const result = await renderRoot();
        expect(result.queryByTestId('root-stack')).not.toBeNull();
    });

    it('survives Google Play Billing being unavailable', async () => {
        iapMock.__configure({ available: false });

        const result = await renderRoot();
        expect(result.queryByTestId('root-stack')).not.toBeNull();
    });

    it('survives push-token registration rejecting', async () => {
        notificationsMock.__configure({ tokenError: true });

        const result = await renderRoot();
        expect(result.queryByTestId('root-stack')).not.toBeNull();
    });

    it('survives registering a resolved push token with the API failing', async () => {
        apiMock.__configure({ pushRegisterError: true });

        const result = await renderRoot();
        expect(result.queryByTestId('root-stack')).not.toBeNull();
    });

    it('survives the API being offline', async () => {
        apiMock.__configure({ offline: true });

        const result = await renderRoot();
        expect(result.queryByTestId('root-stack')).not.toBeNull();
    });
});
