/**
 * Render/visibility tests for every tab screen.
 *
 * These are deliberately stricter than the earlier smoke tests: every asserted
 * element must be visible AND have no invisible/collapsed ancestor (see
 * helpers/visibility.ts). Run against the current code they fail on the shared
 * wrapper collapse, which is the blank-release-screen repro.
 */

import React, { act } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { MatchData } from '@trophy-games/shared';

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

import FreeTipsScreen from '../src/app/(tabs)/index';
import PaidTipsScreen from '../src/app/(tabs)/paid';
import VIPTipsScreen from '../src/app/(tabs)/vip';
import WinsScreen from '../src/app/(tabs)/wins';
import MembershipStoreScreen from '../src/app/(tabs)/market';
import { ThemeProvider } from '../src/context/ThemeContext';
import { LanguageProvider } from '../src/context/LanguageContext';
import { UserProvider } from '../src/context/UserContext';
import { DialogProvider } from '../src/context/DialogContext';
import { env, resetEnv, todayKey } from './helpers/testEnv';
import { expectTextVisible, expectVisible, findVisibilityProblems } from './helpers/visibility';
import i18n from '../src/locales';
import { FIXTURE_A_UPCOMING_FREE, FIXTURE_D_UPCOMING_VIP_LOCKED, FIXTURE_D_UPCOMING_PAID_LOCKED } from './helpers/fixtures';

const TODAY = todayKey();

function serverMatch(overrides: Partial<MatchData> = {}): MatchData {
    return {
        ...FIXTURE_A_UPCOMING_FREE,
        id: 'match-home-1',
        matchDate: TODAY,
        timestamp: `${TODAY}T19:00:00Z`,
        status: 'Scheduled',
        ...overrides,
    };
}

function finishedHistory(id: string, result: 'won' | 'lost') {
    return {
        ...serverMatch({ id }),
        status: 'FT',
        result,
        homeScore: result === 'won' ? 2 : 0,
        awayScore: result === 'won' ? 1 : 3,
    };
}

async function renderScreen(Component: React.ComponentType) {
    const result = await render(
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
    return result;
}

function kickoffTime(): string {
    return new Date(`${TODAY}T19:00:00Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

describe('tab screens render real content', () => {
    beforeEach(() => {
        resetEnv();
        jest.clearAllMocks();
        i18n.locale = 'en';
    });

    it('Home: date strip day numbers, league chips, league header, team names, kickoff and tier badge', async () => {
        env.matchesByType.free = [serverMatch()];
        const screen = await renderScreen(FreeTipsScreen);

        expectTextVisible(screen, 'All');
        expect((screen.getAllByText(String(new Date().getDate())).length)).toBeGreaterThan(0);
        expectTextVisible(screen, 'Premier League'); // league header + chip
        expectTextVisible(screen, 'Fixture Town');
        expectTextVisible(screen, 'Generic United');
        expectTextVisible(screen, kickoffTime());
        expectTextVisible(screen, 'Free');
    });

    it('Home: empty state when the API returns no matches', async () => {
        env.matchesByType.free = [];
        const screen = await renderScreen(FreeTipsScreen);
        expectTextVisible(screen, 'No matches found');
    });

    it('Home: error state with Retry when the API rejects', async () => {
        env.matchesMode = 'reject';
        const screen = await renderScreen(FreeTipsScreen);
        expectTextVisible(screen, i18n.t('common.retry'));
    });

    it('VIP locked: shows plan cards with names and prices', async () => {
        env.membership.vip = { status: 'none' };
        const screen = await renderScreen(VIPTipsScreen);
        expectTextVisible(screen, 'VIP WEEKLY');
        expectTextVisible(screen, 'VIP MONTHLY');
        expectTextVisible(screen, 'KSh 200/week');
        expectTextVisible(screen, 'KSh 500/month');
    });

    it('Premium locked: shows the plan card with name and price', async () => {
        env.membership.paid = { status: 'none' };
        const screen = await renderScreen(PaidTipsScreen);
        expectTextVisible(screen, 'PAID MONTHLY');
        expectTextVisible(screen, 'KSh 300/month');
    });

    it('VIP unlocked: active member sees VIP matches', async () => {
        env.membership.vip = { status: 'active' };
        env.matchesByType.vip = [serverMatch({ ...FIXTURE_D_UPCOMING_VIP_LOCKED, matchDate: TODAY, timestamp: `${TODAY}T19:00:00Z` })];
        const screen = await renderScreen(VIPTipsScreen);
        expectTextVisible(screen, 'Fixture Town');
        expectTextVisible(screen, 'VIP');
    });

    it('Premium unlocked: active member sees Premium matches', async () => {
        env.membership.paid = { status: 'active' };
        env.matchesByType.paid = [serverMatch({ ...FIXTURE_D_UPCOMING_PAID_LOCKED, matchDate: TODAY, timestamp: `${TODAY}T19:00:00Z` })];
        const screen = await renderScreen(PaidTipsScreen);
        expectTextVisible(screen, 'Fixture Town');
        expectTextVisible(screen, 'Paid');
    });

    it('Store: hero and all three plan cards with prices', async () => {
        const screen = await renderScreen(MembershipStoreScreen);
        expectTextVisible(screen, 'UNLEASH THE POWER OF AI');
        expectTextVisible(screen, 'VIP WEEKLY');
        expectTextVisible(screen, 'VIP MONTHLY');
        expectTextVisible(screen, 'PAID MONTHLY');
        expectTextVisible(screen, 'KSh 200/week');
        expectTextVisible(screen, 'KSh 500/month');
        expectTextVisible(screen, 'KSh 300/month');
    });

    it('Analysis: date strip, strike rate and finished rows with WIN/LOSS badges', async () => {
        env.history = {
            matches: [finishedHistory('m-win', 'won'), finishedHistory('m-loss', 'lost')],
            strikeRate: 68,
            strikeRate30d: 71,
        };
        const screen = await renderScreen(WinsScreen);
        expect((screen.getAllByText(String(new Date().getDate())).length)).toBeGreaterThan(0);
        expectTextVisible(screen, '68%');
        expectTextVisible(screen, '71%');
        expectTextVisible(screen, 'WIN');
        expectTextVisible(screen, 'LOSS');
        expectTextVisible(screen, 'Fixture Town');
    });

    it('tapping a match row opens the details page with the match id', async () => {
        env.matchesByType.free = [serverMatch()];
        const pushed: unknown[][] = [];
        env.routerPush = (...args: unknown[]) => { pushed.push(args); };
        const screen = await renderScreen(FreeTipsScreen);
        const row = screen.getByLabelText('Fixture Town vs Generic United');
        expectVisible(row);
        await act(async () => { fireEvent.press(row); });
        expect(pushed).toHaveLength(1);
        expect(pushed[0][0]).toMatchObject({
            pathname: '/match/[id]',
            params: { id: 'match-home-1' },
        });
    });

    it('no rendered screen content is hidden by a collapsed wrapper', async () => {
        env.matchesByType.free = [serverMatch()];
        const screen = await renderScreen(FreeTipsScreen);
        const team = screen.getByText('Fixture Town');
        // The assertion is the point; the message explains the exact failure.
        expect(findVisibilityProblems(team)).toEqual([]);
    });
});
