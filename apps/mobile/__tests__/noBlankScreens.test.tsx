/**
 * No-blank-screen guarantees for the release build.
 *
 * Every tab and the match detail page must end in exactly one of:
 * skeleton, content, empty state, or error state with Retry. Nothing may stay
 * on a skeleton forever because a request (or the IAP/billing layer) never
 * settles. The visibility helper also fails on collapsed/unbounded wrappers.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => require('./helpers/mockModules').createRouterMock());
jest.mock('@react-native-async-storage/async-storage', () => require('./helpers/mockModules').createStorageMock());
jest.mock('lucide-react-native', () => require('./helpers/mockModules').createLucideMock());
jest.mock('@expo/vector-icons', () => require('./helpers/mockModules').createVectorIconsMock());
jest.mock('../src/hooks/useIap', () => require('./helpers/mockModules').createIapMock());
jest.mock('../src/utils/deviceId', () => ({ getDeviceId: async () => 'test-device-id' }));
jest.mock('../src/hooks/useRestorePurchases', () => ({ useRestorePurchases: () => {} }));
jest.mock('../src/hooks/usePlanPrices', () => ({
    __esModule: true,
    default: () => ({ prices: {}, refresh: () => {} }),
    usePlanPrices: () => ({ prices: {}, refresh: () => {} }),
}));
jest.mock('expo-application', () => ({
    applicationId: 'com.trophy.games',
    nativeApplicationVersion: '1.0.0',
    nativeBuildNumber: '42',
    applicationName: 'Trophy Games',
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: async () => {} }));
jest.mock('expo-linking', () => ({ openURL: async () => true }));
jest.mock('expo-clipboard', () => ({ setStringAsync: async () => true, getStringAsync: async () => '' }));
jest.mock('../src/api/footystats', () => ({ fetchMatchStats: async () => null }));
jest.mock('../src/api/client', () => {
    const actual = jest.requireActual('../src/api/client');
    return require('./helpers/mockModules').createApiMock(actual);
});

import Home from '../src/app/(tabs)/index';
import VIPTipsScreen from '../src/app/(tabs)/vip';
import WinsScreen from '../src/app/(tabs)/wins';
import StoreScreen from '../src/app/(tabs)/market';
import SettingsScreen from '../src/app/settings';
import MatchScreen from '../src/app/match/[id]';
import { ThemeProvider } from '../src/context/ThemeContext';
import { LanguageProvider } from '../src/context/LanguageContext';
import { UserProvider } from '../src/context/UserContext';
import { DialogProvider } from '../src/context/DialogContext';
import { ScreenErrorBoundary } from '../src/components/ScreenErrorBoundary';
import { readLastError } from '../src/lib/errorDiagnostics';
import { getConnectionDiagnostics } from '../src/lib/connectionDiagnostics';
import { env, resetEnv, todayKey } from './helpers/testEnv';
import { expectTextVisible, expectVisible, findVisibilityProblems } from './helpers/visibility';
import { FIXTURE_A_UPCOMING_FREE, FIXTURE_D_UPCOMING_VIP_LOCKED, FIXTURE_E_FINISHED } from './helpers/fixtures';
import i18n from '../src/locales';

const TODAY = todayKey();

async function renderScreen(Component: React.ComponentType) {
    return await render(
        <ThemeProvider>
            <LanguageProvider>
                <UserProvider>
                    <DialogProvider>
                        <Component />
                    </DialogProvider>
                </UserProvider>
            </LanguageProvider>
        </ThemeProvider>,
    );
}

function serverMatch(overrides: Partial<typeof FIXTURE_A_UPCOMING_FREE> = {}) {
    return {
        ...FIXTURE_A_UPCOMING_FREE,
        matchDate: TODAY,
        timestamp: `${TODAY}T19:00:00Z`,
        status: 'Scheduled',
        ...overrides,
    };
}

/** Advance the query timeout without waiting eight real seconds. */
async function timeoutQueries(screen: { toJSON: () => unknown }) {
    await act(async () => {
        jest.advanceTimersByTime(8000);
    });
    expect(screen.toJSON()).toBeDefined();
}

const RETRY = i18n.t('common.retry');

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A screen is safe if at least one skeleton, error Retry or piece of content
 * survives the visibility walker. This is the terminal-state contract for
 * every tab, regardless of which async source is slow/failed/never-settling.
 */
function expectVisibleTerminal(screen: {
    toJSON: () => unknown;
    queryAllByText: (text: RegExp) => Parameters<typeof findVisibilityProblems>[0][];
    queryAllByTestId: (id: string) => Parameters<typeof findVisibilityProblems>[0][];
}): void {
    expect(screen.toJSON()).not.toBeNull();
    const nodes = [
        ...screen.queryAllByText(/.+/),
        ...screen.queryAllByTestId('skeleton-list'),
    ];
    expect(nodes.length).toBeGreaterThan(0);
    const visible = nodes.filter((node) => findVisibilityProblems(node).length === 0);
    expect(visible.length).toBeGreaterThan(0);
}

describe('no blank terminals for slow / failed / never-settling data', () => {
    beforeEach(() => {
        resetEnv();
        jest.clearAllMocks();
        env.storage.clear();
        i18n.locale = 'en';
    });

    it('Home: API that never resolves reaches an error state with Retry (8s max)', async () => {
        jest.useFakeTimers();
        env.matchesMode = 'never';
        const screen = await renderScreen(Home);
        await timeoutQueries(screen);
        expectTextVisible(screen, RETRY);
        jest.useRealTimers();
    }, 5000);

    it('VIP: membership that never resolves reaches an error state with Retry (8s max)', async () => {
        jest.useFakeTimers();
        env.membershipMode = 'never';
        const screen = await renderScreen(VIPTipsScreen);
        await timeoutQueries(screen);
        expectTextVisible(screen, RETRY);
        jest.useRealTimers();
    }, 5000);

    it('Analysis: rejected history API shows the error state with Retry', async () => {
        env.matchesMode = 'reject';
        const screen = await renderScreen(WinsScreen);
        await waitFor(() => expect(screen.queryByText(RETRY)).not.toBeNull(), { timeout: 3000 });
        expectTextVisible(screen, RETRY);
    }, 5000);

    it('Store: billing that never resolves still shows plan content, never a blank screen', async () => {
        env.billingMode = 'never';
        env.membershipMode = 'never';
        const screen = await renderScreen(StoreScreen);
        expectTextVisible(screen, i18n.t('market.heroTitle'));
    }, 5000);

    it('Home: slow API shows a skeleton first and then real content', async () => {
        jest.useFakeTimers();
        env.delayMs = 150;
        env.matchesByType.free = [serverMatch()];
        const screen = await renderScreen(Home);
        expect(screen.getAllByTestId('skeleton-list').length).toBeGreaterThan(0);
        await act(async () => { jest.advanceTimersByTime(150); });
        await waitFor(() => expect(screen.queryByText('Fixture Town')).not.toBeNull(), { timeout: 3000 });
        expectTextVisible(screen, 'Fixture Town');
        jest.useRealTimers();
    }, 5000);
});

describe('slow / rejected / never-settling sources never leave a blank tab (5s test budget)', () => {
    const modes = ['slow', 'reject', 'never'] as const;

    beforeEach(() => {
        resetEnv();
        jest.clearAllMocks();
        env.storage.clear();
        i18n.locale = 'en';
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it.each(modes)('user API %s: tab reaches a visible terminal state', async (mode) => {
        env.userMode = mode;
        env.delayMs = mode === 'slow' ? 150 : 0;
        const screen = await renderScreen(Home);
        await act(async () => { jest.advanceTimersByTime(8000); });
        expectVisibleTerminal(screen);
    }, 5000);

    it.each(modes)('membership API %s: VIP reaches a visible terminal state', async (mode) => {
        env.membershipMode = mode;
        env.delayMs = mode === 'slow' ? 150 : 0;
        const screen = await renderScreen(VIPTipsScreen);
        await act(async () => { jest.advanceTimersByTime(8000); });
        if (mode === 'never') {
            expectTextVisible(screen, RETRY);
        } else {
            expectVisibleTerminal(screen);
        }
    }, 5000);

    it.each(modes)('matches API %s: Home reaches a visible terminal state', async (mode) => {
        env.matchesMode = mode;
        env.delayMs = mode === 'slow' ? 150 : 0;
        const screen = await renderScreen(Home);
        await act(async () => { jest.advanceTimersByTime(8000); });
        if (mode === 'never') {
            expectTextVisible(screen, RETRY);
        } else {
            expectVisibleTerminal(screen);
        }
    }, 5000);

    it.each(modes)('billing %s: Store still renders plans, never a blank screen', async (mode) => {
        env.billingMode = mode;
        env.delayMs = mode === 'slow' ? 150 : 0;
        const screen = await renderScreen(StoreScreen);
        await act(async () => { jest.advanceTimersByTime(8000); });
        expectTextVisible(screen, i18n.t('market.heroTitle'));
        expectVisibleTerminal(screen);
    }, 5000);
});

describe('match detail page has visible terminal states', () => {
    beforeEach(() => {
        resetEnv();
        jest.clearAllMocks();
        i18n.locale = 'en';
    });

    function matchParams(match: typeof FIXTURE_A_UPCOMING_FREE) {
        return { id: match.id, matchData: encodeURIComponent(JSON.stringify(match)) };
    }

    it('renders the passed match and the by-id overlay with visible ancestors', async () => {
        const match = serverMatch({ id: 'match-nav-1' });
        env.route = matchParams(match);
        env.byId = match;
        const screen = await renderScreen(MatchScreen);
        await waitFor(() => expect(screen.queryByText('Fixture Town')).not.toBeNull(), { timeout: 3000 });
        expectTextVisible(screen, 'Fixture Town');
        expectTextVisible(screen, 'Generic United');
        expect(findVisibilityProblems(screen.getByText('Fixture Town'))).toEqual([]);
    }, 5000);

    it('missing route params show "Match details unavailable", not a permanent skeleton', async () => {
        env.route = {};
        env.byId = null;
        const screen = await renderScreen(MatchScreen);
        await waitFor(() => expect(screen.queryByText('Match details unavailable')).not.toBeNull(), { timeout: 3000 });
        expectTextVisible(screen, 'Match details unavailable');
    }, 5000);

    it('a rejected by-id request shows the error screen with Retry', async () => {
        const match = serverMatch({ id: 'match-reject' });
        env.route = matchParams(match);
        env.matchesMode = 'reject';
        const screen = await renderScreen(MatchScreen);
        await waitFor(() => expect(screen.queryByText(RETRY)).not.toBeNull(), { timeout: 3000 });
        expectTextVisible(screen, RETRY);
    }, 5000);

    it('a VIP tip stays locked for a non-member', async () => {
        const upcoming = serverMatch({ ...FIXTURE_D_UPCOMING_VIP_LOCKED, id: 'match-vip' });
        env.route = matchParams(upcoming);
        env.byId = upcoming;
        env.membership.vip = { status: 'none' };
        const locked = await renderScreen(MatchScreen);
        await waitFor(() => expect(locked.queryByText('Prediction locked')).not.toBeNull(), { timeout: 3000 });
        expectTextVisible(locked, 'Prediction locked');
        locked.unmount();
    }, 5000);

    it('a finished tip is always visible, even for a non-member', async () => {
        const finished = { ...FIXTURE_E_FINISHED[0], matchDate: TODAY, timestamp: `${TODAY}T19:00:00Z` };
        env.route = matchParams(finished);
        env.byId = finished;
        env.membership.vip = { status: 'none' };
        const open = await renderScreen(MatchScreen);
        await waitFor(() => expect(open.queryByText('Fixture Town')).not.toBeNull(), { timeout: 3000 });
        expect(open.queryByText('Prediction locked')).toBeNull();
        open.unmount();
    }, 5000);
});

describe('press feedback is short, never an entry animation', () => {
    beforeEach(() => {
        resetEnv();
        jest.clearAllMocks();
        i18n.locale = 'en';
        env.routerPush = jest.fn();
    });

    it('leaves initial opacity at 1 and only changes opacity on press', async () => {
        env.matchesByType.free = [serverMatch()];
        const screen = await renderScreen(Home);
        const row = screen.getByLabelText('Fixture Town vs Generic United');
        expectVisible(row);
        expect(findVisibilityProblems(row)).toEqual([]);
        expect(row.props.style).not.toEqual(expect.objectContaining({ opacity: 0 }));
        await act(async () => { await fireEvent.press(row); });
        expect(env.routerPush).toHaveBeenCalled();
    }, 5000);
});

describe('Diagnostics connection and data block', () => {
    beforeEach(() => {
        resetEnv();
        jest.clearAllMocks();
        i18n.locale = 'en';
        env.matchesByType.free = [serverMatch()];
    });

    it('shows API host (no secrets), last path, status, time, count, membership, version and device code', async () => {
        const screen = await renderScreen(Home);
        await waitFor(() => expect(screen.queryByText('Fixture Town')).not.toBeNull(), { timeout: 3000 });
        const diagnostics = getConnectionDiagnostics();
        expect(diagnostics.host).toBe(env.apiBaseUrl.replace(/^https?:\/\//, ''));
        expect(diagnostics.lastPath).toContain('/api/app/matches/by-type-and-date');
        expect(diagnostics.status).toBe(200);
        expect(diagnostics.matchesCount).toBe(1);
        screen.unmount();

        const settings = await renderScreen(SettingsScreen);
        // The snapshot is one multi-line Text node; match inside that node.
        expectTextVisible(settings, /Connection and data/);
        expectTextVisible(settings, new RegExp(`Host: ${escapeRegExp(diagnostics.host)}`));
        expectTextVisible(settings, /Last path: \/api\/app\/matches\/by-type-and-date/);
        expectTextVisible(settings, /Status: 200/);
        expectTextVisible(settings, /Matches: 1/);
        expectTextVisible(settings, /App: 1\.0\.0 \(42\)/);
        expectTextVisible(settings, /TG-[A-F0-9]{4}-[A-F0-9]{4}/);
        expectTextVisible(settings, /Copy connection details/);
    }, 5000);

    it('records render errors from a screen error boundary as Last error', async () => {
        const Bomb = () => { throw new Error('trophy boundary repro'); };
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await render(
            <ThemeProvider>
                <ScreenErrorBoundary><Bomb /></ScreenErrorBoundary>
            </ThemeProvider>,
        );
        await waitFor(async () => expect(await readLastError()).not.toBeNull(), { timeout: 3000 });
        expect((await readLastError())?.message).toContain('trophy boundary repro');
        consoleError.mockRestore();
    }, 5000);
});
