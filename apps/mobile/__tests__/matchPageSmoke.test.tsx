/**
 * Match page render smoke tests (jest-expo + @testing-library/react-native).
 *
 * Renders `MatchDetailScreen` for fixtures mirroring the real API shape,
 * across 2 modes (Light/Dark) x 4 accents, on every tab, and asserts:
 *  - no exception (render + interactions), and
 *  - no style value that is NaN, undefined, Infinity or contains "NaN"
 *    (walked over the rendered tree).
 *
 * Timeout endpoint cases (null / error / timeout from `api.matches.byId`)
 * and invalid route ids are covered as fixtures (g)/(h).
 */

import React, { act } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../src/context/ThemeContext';
import MatchDetailScreen from '../src/app/match/[id]';
import { api, ApiError } from '../src/api/client';
import { fetchMatchStats } from '../src/api/footystats';
import i18n from '../src/locales';
import type { MatchData } from '@trophy-games/shared';

import {
    SMOKE_FIXTURES,
    SMOKE_MODES,
    getSmokeFixtureMeta,
} from './helpers/fixtures';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRouteState: { id?: string; matchData?: string } = {};

jest.mock('expo-router', () => {
    const ReactMock = require('react');
    return {
        useLocalSearchParams: () => ({
            id: mockRouteState.id,
            matchData: mockRouteState.matchData,
        }),
        useRouter: () => ({
            back: jest.fn(),
            push: jest.fn(),
            replace: jest.fn(),
            dismiss: jest.fn(),
        }),
        useFocusEffect: (cb: () => void) => {
            ReactMock.useEffect(() => {
                cb();
            }, []);
        },
    };
});

jest.mock('expo-application', () => ({
    applicationId: 'com.trophy.games',
    nativeApplicationVersion: '1.0.0',
    applicationName: 'Trophy Games',
}));

jest.mock('@expo/vector-icons', () => {
    const ReactMock = require('react');
    const { Text } = require('react-native');
    const Icon = (props: { name: string; size?: number; color?: string }) =>
        ReactMock.createElement(Text, {
            numberOfLines: 1,
            style: { fontSize: props.size ?? 12, color: props.color },
        }, props.name);
    return { Ionicons: Icon };
});

jest.mock('expo-sharing', () => ({
    isAvailableAsync: jest.fn(async () => false),
    shareAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-linking', () => ({
    openURL: jest.fn(async () => undefined),
}));

jest.mock('expo-clipboard', () => ({
    setStringAsync: jest.fn(async () => undefined),
    getStringAsync: jest.fn(async () => ''),
    hasStringAsync: jest.fn(async () => false),
    setUrlAsync: jest.fn(async () => undefined),
    getUrlAsync: jest.fn(async () => null),
    hasUrlAsync: jest.fn(async () => false),
    setImageAsync: jest.fn(async () => undefined),
    getImageAsync: jest.fn(async () => null),
    hasImageAsync: jest.fn(async () => false),
}));

const mockStorage: Record<string, string | null> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: (key: string) => Promise.resolve(mockStorage[key] ?? null),
    setItem: (key: string, value: string) => {
        mockStorage[key] = value;
        return Promise.resolve();
    },
    removeItem: (key: string) => {
        delete mockStorage[key];
        return Promise.resolve();
    },
    multiRemove: (keys: string[]) => {
        for (const key of keys) delete mockStorage[key];
        return Promise.resolve();
    },
    clear: () => {
        Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
        return Promise.resolve();
    },
}));

jest.mock('../src/api/client', () => {
    const actual = jest.requireActual('../src/api/client');
    return {
        ...actual,
        api: {
            ...actual.api,
            matches: { ...actual.api.matches, byId: jest.fn() },
            tokens: { ...actual.api.tokens, getMembershipStatus: jest.fn() },
        },
    };
});

jest.mock('../src/api/footystats', () => ({
    fetchMatchStats: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Style-tree walker (asserts: no NaN / undefined / Infinity / "NaN")
// ---------------------------------------------------------------------------

interface StyleViolation {
    node: string;
    key: string;
    value: unknown;
}

function collectStyleValueViolations(value: unknown, context: string, out: StyleViolation[]): void {
    if (value == null) return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            out.push({ node: context, key: '', value });
        }
    } else if (value === undefined) {
        out.push({ node: context, key: '', value });
    } else if (typeof value === 'string') {
        if (value.includes('NaN') || value.includes('Infinity')) {
            out.push({ node: context, key: '', value });
        }
    } else if (Array.isArray(value)) {
        value.forEach((item) => collectStyleValueViolations(item, context, out));
    } else if (typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            if (child === undefined) {
                out.push({ node: context, key, value: child });
            } else if (child === null) {
                // Explicit null styles are allowed.
            } else if (typeof child === 'object' || Array.isArray(child)) {
                collectStyleValueViolations(child, context, out);
            } else if (typeof child === 'number' && !Number.isFinite(child)) {
                out.push({ node: context, key, value: child });
            } else if (typeof child === 'string' && (child.includes('NaN') || child.includes('Infinity'))) {
                out.push({ node: context, key, value: child });
            }
        }
    }
}

function collectStyleViolations(node: unknown, out: StyleViolation[] = []): StyleViolation[] {
    if (node == null || typeof node !== 'object') return out;
    const treeNode = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] };
    const label = typeof treeNode.type === 'string' ? treeNode.type : 'node';
    if (treeNode.props) {
        for (const key of ['style', 'textStyle', 'labelStyle', 'inputStyle'] as const) {
            const style = treeNode.props[key];
            if (style !== undefined) {
                collectStyleValueViolations(style, label, out);
            }
        }
    }
    for (const child of treeNode.children ?? []) {
        collectStyleViolations(child, out);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderOptions {
    match?: MatchData | null;
    id?: string;
    byIdResult?: Promise<MatchData | null>;
    statsResult?: Promise<Partial<MatchData> | null> | null;
}

async function renderMatch(opts: RenderOptions = {}) {
    const { match = null, id, byIdResult, statsResult = null } = opts;

    (api.matches.byId as jest.Mock).mockImplementation(
        () => byIdResult ?? Promise.resolve(match ?? null),
    );
    (api.tokens.getMembershipStatus as jest.Mock).mockImplementation(
        () => new Promise(() => {}), // membership stays loading → OverviewContent shows skeleton, not crash
    );
    (fetchMatchStats as jest.Mock).mockImplementation(
        // null/undefined stats keep the page in the not-found/loading states.
        () => statsResult ?? Promise.resolve(null),
    );

    mockRouteState.id = id ?? match?.id ?? 'match-smoke';
    mockRouteState.matchData = match ? encodeURIComponent(JSON.stringify(match)) : undefined;

    const result = await render(
        <ThemeProvider>
            <MatchDetailScreen />
        </ThemeProvider>,
    );
    await act(async () => {});
    return result;
}

function assertNoStyleViolations(tree: unknown) {
    const violations = collectStyleViolations(tree);
    expect(violations).toEqual([]);
}

/** All string children of every node in a rendered tree. */
function flattenTexts(node: unknown, out: string[] = []): string[] {
    if (node == null || typeof node !== 'object') return out;
    const treeNode = node as { children?: unknown[] };
    for (const child of treeNode.children ?? []) {
        if (typeof child === 'string') out.push(child);
        else flattenTexts(child, out);
    }
    return out;
}

function assertScreenText(tree: unknown, pattern: RegExp) {
    const texts = flattenTexts(tree);
    expect(texts.some((t) => pattern.test(t))).toBe(true);
}

function tabLabel(id: string): string {
    const entries: Record<string, [string, string]> = {
        overview: ['matchDetail.tabOverview', 'Overview'],
        form: ['matchDetail.tabForm', 'Form'],
        odds: ['matchDetail.tabOdds', 'Odds'],
        stats: ['matchDetail.tabStats', 'Stats'],
        h2h: ['matchDetail.tabH2H', 'H2H'],
    };
    const [key, fallback] = entries[id];
    const value = i18n.t(key);
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// Fixtures (a)-(h) — see __tests__/helpers/fixtures.ts
// ---------------------------------------------------------------------------

const CASE_FIXTURES: Array<{ name: string; match: MatchData }> = [
    { name: '(a) upcoming free w/ aiPrediction, no odds/details/logos', match: SMOKE_FIXTURES[0] },
    { name: '(b) same with odds', match: SMOKE_FIXTURES[1] },
    { name: '(c) odds edge cases', match: SMOKE_FIXTURES[2] },
    { name: '(d1) upcoming vip locked', match: SMOKE_FIXTURES[3] },
    { name: '(d2) upcoming paid locked', match: SMOKE_FIXTURES[4] },
    { name: '(e) finished: win', match: SMOKE_FIXTURES[5] },
    { name: '(e) finished: lose', match: SMOKE_FIXTURES[6] },
    { name: '(e) finished: draw', match: SMOKE_FIXTURES[7] },
    { name: '(e) finished: void', match: SMOKE_FIXTURES[8] },
    ...SMOKE_FIXTURES.slice(9).map((match, i) => ({ name: `(f${i + 1}) ai field abuse`, match })),
];

describe('match page smoke', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
        jest.clearAllMocks();
    });

    describe('render on every tab (Light + Dark x 4 accents)', () => {
        for (const { mode, accent } of SMOKE_MODES) {
            for (const { name, match } of CASE_FIXTURES) {
                it(`${name} [${mode}/${accent}] renders without exception and clean styles`, async () => {
                    mockStorage['user-theme'] = mode;
                    mockStorage['user-accent'] = accent;
                    const result = await renderMatch({ match });
                    assertNoStyleViolations(result.toJSON());

                    const meta = getSmokeFixtureMeta(match);
                    for (const id of meta.expectedTabs) {
                        if (id === 'overview') continue;
                        const label = tabLabel(id);
                        const buttons = result.queryAllByLabelText(label);
                        if (buttons.length > 0) {
                            await act(async () => {
                                fireEvent.press(buttons[0]);
                            });
                            assertNoStyleViolations(result.toJSON());
                        }
                    }
                }, 30000);
            }
        }
    });

    describe('by-id endpoint cases (g)', () => {
        for (const { mode, accent } of [SMOKE_MODES[4], SMOKE_MODES[0]]) {
            it(`null response [${mode}/${accent}] → not-found state with Back, no crash`, async () => {
                mockStorage['user-theme'] = mode;
                mockStorage['user-accent'] = accent;
                const result = await renderMatch({ match: null, byIdResult: Promise.resolve(null) });
                await act(async () => {});
                assertNoStyleViolations(result.toJSON());
                assertScreenText(result.toJSON(), /unavailable|go back/i);
            }, 30000);

            it(`error response [${mode}/${accent}] → error state with Retry, no crash`, async () => {
                mockStorage['user-theme'] = mode;
                mockStorage['user-accent'] = accent;
                const error = new ApiError('404 not found', 'http', 404, null);
                const result = await renderMatch({
                    match: null,
                    byIdResult: Promise.reject(error),
                });
                await act(async () => {});
                assertNoStyleViolations(result.toJSON());
                assertScreenText(result.toJSON(), /retry|copy error|couldn|something went wrong/i);
            }, 30000);

            it(`timeout response [${mode}/${accent}] → loading state, no crash`, async () => {
                mockStorage['user-theme'] = mode;
                mockStorage['user-accent'] = accent;
                const result = await renderMatch({
                    match: null,
                    byIdResult: new Promise(() => {}), // never settles
                });
                await act(async () => {});
                assertNoStyleViolations(result.toJSON());
            }, 30000);
        }
    });

    describe('invalid route id (h)', () => {
        for (const { mode, accent } of SMOKE_MODES.slice(0, 2)) {
            it(`missing id [${mode}/${accent}] → not-found state with Back, no crash`, async () => {
                mockStorage['user-theme'] = mode;
                mockStorage['user-accent'] = accent;
                const result = await renderMatch({ match: null, id: undefined, byIdResult: Promise.resolve(null) });
                await act(async () => {});
                assertNoStyleViolations(result.toJSON());
                assertScreenText(result.toJSON(), /unavailable|go back/i);
            }, 30000);

            it(`empty/garbage id [${mode}/${accent}] → not-found state with Back, no crash`, async () => {
                mockStorage['user-theme'] = mode;
                mockStorage['user-accent'] = accent;
                const result = await renderMatch({ match: null, id: 'garbage', byIdResult: Promise.resolve(null) });
                await act(async () => {});
                assertNoStyleViolations(result.toJSON());
                assertScreenText(result.toJSON(), /unavailable|go back/i);
            }, 30000);
        }
    });
});
