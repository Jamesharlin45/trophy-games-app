/**
 * Fixtures for the match-page smoke tests.
 *
 * They mirror the real API shape (`MatchData` from packages/shared — the same
 * shape the web API returns via `api.matches.byId`). Like the real API, every
 * field may be missing or null, and odds are STRINGS ("1.77").
 */

import type { MatchData } from '@trophy-games/shared';
import type { MatchDetailData } from '../../src/api/footystats';

/** Upcoming Free match with an AI prediction but NO odds/details/logos (the crash repro). */
export const FIXTURE_A_UPCOMING_FREE: MatchData = {
    id: 'match-a',
    league: 'Premier League',
    leagueLogo: 'https://example.com/epl.png',
    country: 'England',
    timestamp: '2026-11-30T19:00:00Z',
    status: 'Upcoming',
    score: '',
    homeTeam: 'Fixture Town',
    awayTeam: 'Generic United',
    homeScore: undefined,
    awayScore: undefined,
    homeTeamLogo: undefined,
    awayTeamLogo: undefined,
    matchType: 'free',
    homeForm: '',
    awayForm: '',
    aiPrediction: {
        prediction: 'Home wins',
        confidence: 68,
        reasoning: ['Home team in good form'],
        generatedAt: '2026-11-20T08:00:00Z',
        risk: 'medium',
        sources: ['https://example.com/analysis'],
        pick: '1',
        suggestedBet: '1',
    },
};

/** Same as (a) but WITH pre-match odds in the real string format. */
export const FIXTURE_B_UPCOMING_FREE_WITH_ODDS: MatchData = {
    ...FIXTURE_A_UPCOMING_FREE,
    id: 'match-b',
    odds: { home: '1.77', draw: '3.15', away: '2.22' },
    detailedOdds: {
        ft: { '1x2': { home: '1.77', draw: '3.15', away: '2.22' } },
        ht: { '1x2': { home: '1.55', draw: '3.45', away: '2.1' } },
    },
};

/** Odds with edge cases: missing draw, a 0, an empty string and a non-numeric string. */
export const FIXTURE_C_ODDS_EDGE_CASES: MatchData = {
    ...FIXTURE_A_UPCOMING_FREE,
    id: 'match-c',
    odds: { home: '', draw: '0', away: 'abc' },
    detailedOdds: {
        ft: { '1x2': { home: '2.5', draw: '', away: 'not-a-number' } },
    },
};

/** Upcoming VIP and Paid matches — locked without access. */
export const FIXTURE_D_UPCOMING_VIP_LOCKED: MatchData = {
    ...FIXTURE_A_UPCOMING_FREE,
    id: 'match-d-vip',
    matchType: 'vip',
    aiPrediction: { prediction: 'VIP pick', confidence: 72, reasoning: [], generatedAt: '2026-11-20T08:00:00Z' },
};
export const FIXTURE_D_UPCOMING_PAID_LOCKED: MatchData = {
    ...FIXTURE_A_UPCOMING_FREE,
    id: 'match-d-paid',
    matchType: 'paid',
    aiPrediction: { prediction: 'Paid pick', confidence: 55, generatedAt: '2026-11-20T08:00:00Z' } as MatchData['aiPrediction'],
};

/** Finished matches for every result vocabulary. */
export function makeFinishedMatch(opts: {
    id: string;
    result: MatchData['result'];
    homeScore?: number;
    awayScore?: number;
}): MatchData {
    return {
        ...FIXTURE_A_UPCOMING_FREE,
        id: opts.id,
        status: 'Finished',
        homeScore: opts.homeScore,
        awayScore: opts.awayScore,
        result: opts.result,
        aiPrediction: {
            prediction: 'Home wins',
            confidence: 62,
            reasoning: ['Expected from form'],
            generatedAt: '2026-11-20T08:00:00Z',
            sources: ['https://example.com/analysis'],
            pick: '1',
        },
    };
}
export const FIXTURE_E_FINISHED: MatchData[] = [
    makeFinishedMatch({ id: 'match-e-win', result: 'win', homeScore: 3, awayScore: 1 }),
    makeFinishedMatch({ id: 'match-e-lose', result: 'lose', homeScore: 0, awayScore: 2 }),
    makeFinishedMatch({ id: 'match-e-draw', result: 'draw', homeScore: 1, awayScore: 1 }),
    makeFinishedMatch({ id: 'match-e-void', result: 'void', homeScore: 1, awayScore: 1 }),
];

/** AI prediction field abuse: missing/empty reasoning, sources, risk, suggestedBet,
 * and confidence as number / string / null / above 100 / below 0. */
export const FIXTURE_F_AI_FIELDS: MatchData[] = [
    FIXTURE_A_UPCOMING_FREE, // base: everything present
    {
        ...FIXTURE_A_UPCOMING_FREE,
        id: 'match-f-missing',
        aiPrediction: {
            prediction: 'Home wins',
            confidence: 80,
            generatedAt: '2026-11-20T08:00:00Z',
        } as MatchData['aiPrediction'],
    },
    {
        ...FIXTURE_A_UPCOMING_FREE,
        id: 'match-f-empty',
        aiPrediction: {
            prediction: 'Home wins',
            confidence: 80,
            reasoning: [],
            sources: [],
            risk: undefined,
            suggestedBet: '',
            generatedAt: '2026-11-20T08:00:00Z',
        },
    },
    {
        ...FIXTURE_A_UPCOMING_FREE,
        id: 'match-f-conf-string',
        aiPrediction: { ...FIXTURE_A_UPCOMING_FREE.aiPrediction!, confidence: '68' as unknown as number },
    },
    {
        ...FIXTURE_A_UPCOMING_FREE,
        id: 'match-f-conf-null',
        aiPrediction: { ...FIXTURE_A_UPCOMING_FREE.aiPrediction!, confidence: null as unknown as number },
    },
    {
        ...FIXTURE_A_UPCOMING_FREE,
        id: 'match-f-conf-above',
        aiPrediction: { ...FIXTURE_A_UPCOMING_FREE.aiPrediction!, confidence: 120 },
    },
    {
        ...FIXTURE_A_UPCOMING_FREE,
        id: 'match-f-conf-below',
        aiPrediction: { ...FIXTURE_A_UPCOMING_FREE.aiPrediction!, confidence: -5 },
    },
];

/**
 * API responses for the by-id endpoint in the smoke tests:
 * null / error / timeout — plus a "null with no exception" case.
 */
export const FIXTURE_G_BYID: Array<{ name: string; respond: () => Promise<MatchData | null> }> = [
    { name: 'byId-null', respond: async () => null },
    { name: 'byId-error', respond: async () => { throw new Error('API 404'); } },
    { name: 'byId-timeout', respond: () => new Promise(() => {}) }, // never settles
    { name: 'byId-rejects-null', respond: async () => null },
];

/** A "rich stats" payload the page merges after byId — empty for most fixtures. */
export const FIXTURE_RICH_STATS: Partial<MatchDetailData> = {};

/**
 * All data fixtures the smoke test renders: (a) upcoming free w/ prediction,
 * (b) odds, (c) odds edge cases, (d) locked vip/paid, (e) finished results,
 * (f) ai-prediction field abuse.
 */
export const SMOKE_FIXTURES: MatchData[] = [
    FIXTURE_A_UPCOMING_FREE,
    FIXTURE_B_UPCOMING_FREE_WITH_ODDS,
    FIXTURE_C_ODDS_EDGE_CASES,
    FIXTURE_D_UPCOMING_VIP_LOCKED,
    FIXTURE_D_UPCOMING_PAID_LOCKED,
    ...FIXTURE_E_FINISHED,
    ...FIXTURE_F_AI_FIELDS,
];

export const SMOKE_MODES: Array<{ mode: 'light' | 'dark'; accent: string }> = [
    { mode: 'light', accent: 'pitchGreen' },
    { mode: 'light', accent: 'gold' },
    { mode: 'light', accent: 'oceanBlue' },
    { mode: 'light', accent: 'royalPurple' },
    { mode: 'dark', accent: 'pitchGreen' },
    { mode: 'dark', accent: 'gold' },
    { mode: 'dark', accent: 'oceanBlue' },
    { mode: 'dark', accent: 'royalPurple' },
];

export type SmokeFixtureMeta = {
    /** Expected tab ids for "render on every tab": from the match data itself. */
    expectedTabs: string[];
};

export function getSmokeFixtureMeta(match: MatchData): SmokeFixtureMeta {
    const hasForm = Boolean(((match.homeForm || match.awayForm) ?? '').trim());
    const hasOdds = Boolean(
        match.detailedOdds?.ft?.['1x2'] &&
        (match.detailedOdds.ft['1x2'].home || match.detailedOdds.ft['1x2'].draw || match.detailedOdds.ft['1x2'].away),
    );
    const hasStats = Boolean(match.stats && match.stats.length > 0);
    const hasH2h = Boolean(match.h2h?.history && match.h2h.history.length > 0);
    return {
        expectedTabs: [
            'overview',
            ...(hasForm ? ['form'] : []),
            ...(hasOdds ? ['odds'] : []),
            ...(hasStats ? ['stats'] : []),
            ...(hasH2h ? ['h2h'] : []),
        ],
    };
}
