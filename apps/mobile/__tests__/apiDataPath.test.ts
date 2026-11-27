/**
 * API data-path tests: base URL from eas.json, endpoint shapes, mappers and
 * tier/history/unpublished rules. Uses realistic payloads (odds as strings,
 * snake_case AI fields) and asserts that valid matches are not dropped.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const TODAY = '2026-11-27';

function productionApiUrl(): string {
    const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/mobile/eas.json'), 'utf8')) as {
        build: { production?: { env?: Record<string, string> } };
    };
    const url = eas.build.production?.env?.EXPO_PUBLIC_API_URL;
    if (!url) throw new Error('production EXPO_PUBLIC_API_URL missing from eas.json');
    return url.replace(/\/+$/, '');
}

interface FetchCall { url: string; init?:RequestInit }

/** Queue a one-shot fetch result while still recording the request. */
function enqueue(body: unknown, status = 200) {
    (globalThis.fetch as jest.Mock).mockImplementationOnce(async (url, init) => {
        callsForCurrentTest.push({ url: String(url), init: init as RequestInit | undefined });
        return response(body, status);
    });
}

let callsForCurrentTest: FetchCall[] = [];

function response(body: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    } as Response;
}

describe('mobile web API data path', () => {
    const originalEnv = process.env.EXPO_PUBLIC_API_URL;
    let calls: FetchCall[];
    let client: typeof import('../src/api/client');

    beforeEach(() => {
        calls = [];
        callsForCurrentTest = calls;
        process.env.EXPO_PUBLIC_API_URL = productionApiUrl();
        jest.resetModules();
        jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
            calls.push({ url: String(url), init: init as RequestInit | undefined });
            return response([]);
        });
        client = require('../src/api/client') as typeof import('../src/api/client');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(() => {
        if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_API_URL;
        else process.env.EXPO_PUBLIC_API_URL = originalEnv;
    });

    it('uses the production host and /api/app prefix with no trailing slash', () => {
        expect(client.API_BASE_URL).toBe(productionApiUrl());
        expect(client.API_BASE_URL).toBe('https://trophy-games-app.vercel.app');
        expect(client.isApiConfigured).toBe(true);
    });

    it('GET /matches/by-type-and-date keeps every valid match from a realistic payload', async () => {
        const payload = [
            {
                id: 'af-1', matchType: 'free', league: 'Premier League', homeTeam: 'Fixture Town',
                awayTeam: 'Generic United', matchDate: TODAY, timestamp: `${TODAY}T19:00:00Z`,
                status: 'Upcoming', aiPrediction: { prediction: 'Home wins', confidence: 68, reasoning: ['Form'] },
            },
            {
                id: 'af-2', matchType: 'paid', league: 'Premier League', homeTeam: 'Paid FC',
                awayTeam: 'Rival United', matchDate: TODAY, timestamp: `${TODAY}T21:00:00Z`,
                status: 'Upcoming', aiPrediction: { prediction: 'Draw', confidence: '55', reasoning: [] },
            },
            {
                id: 'af-3', matchType: 'vip', league: 'Serie A', homeTeam: 'VIP FC',
                awayTeam: 'Other United', matchDate: TODAY, timestamp: `${TODAY}T20:00:00Z`,
                status: 'Upcoming', aiPrediction: { prediction: 'Away wins', confidence: 72, reasoning: ['H2H'] },
            },
        ];
        enqueue(payload);

        const matches = await client.api.matches.byTypeAndDate('free', TODAY, 100);

        expect(calls[0].url).toBe(
            `${productionApiUrl()}/api/app/matches/by-type-and-date?matchType=free&date=${TODAY}&limit=100`,
        );
        expect(calls[0].init?.method ?? 'GET').toBe('GET');
        expect(matches).toHaveLength(3);
        expect(matches.map((m) => m.id)).toEqual(['af-1', 'af-2', 'af-3']);
        expect(matches[0].aiPrediction?.prediction).toBe('Home wins');
        expect((matches[1].aiPrediction?.confidence as unknown)).toBe('55');
    });

    it('GET /matches/by-id maps string odds and snake_case AI fields without dropping the pick', async () => {
        const detail = {
            id: 'af-1', league: 'Premier League', homeTeam: 'Fixture Town', awayTeam: 'Generic United',
            timestamp: `${TODAY}T19:00:00Z`, status: 'Upcoming', matchType: 'free',
            detailedOdds: { ft: { '1x2': { home: '1.77', draw: '3.15', away: '2.22' } } },
            ai_prediction: {
                pick: '1', confidence: '68', reasoning: ['Home in form', ''],
                sources: ['https://example.com/a', 'https://example.com/a'],
            },
        };
        enqueue(detail);

        const match = await client.api.matches.byId('af-1');
        expect(calls[0].url).toBe(`${productionApiUrl()}/api/app/matches/by-id?matchId=af-1`);
        expect(match).not.toBeNull();

        const { normalizedOdds, parseConfidence, sourceUrls, reasoningLines, pickTextFrom } =
            require('../src/utils/matchData') as typeof import('../src/utils/matchData');
        const rawMatch = match as unknown as Record<string, unknown>;
        const ai = rawMatch.ai_prediction as Record<string, unknown>;
        const ft = (rawMatch.detailedOdds as Record<string, unknown> | undefined)?.ft as Record<string, unknown> | undefined;
        expect(normalizedOdds(ft?.['1x2'] as Parameters<typeof normalizedOdds>[0]))
            .toEqual({ home: '1.77', draw: '3.15', away: '2.22' });
        expect(parseConfidence(ai.confidence)).toBe(68);
        expect(sourceUrls(ai)).toEqual(['https://example.com/a']);
        expect(reasoningLines(ai)).toEqual(['Home in form']);
        expect(pickTextFrom(ai)).toBe('1');
    });

    it('GET /matches/history uses the published result vocabulary and strike rates', async () => {
        const payload = {
            matches: [
                { id: 'h1', result: 'win', matchType: 'free', aiPrediction: { prediction: 'Home' } },
                { id: 'h2', result: 'lose', matchType: 'vip', aiPrediction: { prediction: 'Away' } },
                { id: 'h3', result: 'void', matchType: 'paid', aiPrediction: { prediction: 'Draw' } },
            ],
            strikeRate: 50,
            strikeRate30d: 60,
        };
        enqueue(payload);

        const history = await client.api.matches.history(200, TODAY);
        expect(calls[0].url).toBe(`${productionApiUrl()}/api/app/matches/history?limit=200&date=${TODAY}`);
        expect(history.matches).toHaveLength(3);
        expect(history.matches.map((m) => m.result)).toEqual(['win', 'lose', 'void']);
        expect(history.strikeRate).toBe(50);
    });

    it('enforces tier, history and unpublished-pick rules from the web endpoints', () => {
        const byType = fs.readFileSync(path.join(ROOT, 'apps/web/app/api/app/matches/by-type-and-date/route.ts'), 'utf8');
        expect(byType).toContain("'free', 'paid', 'vip', 'unassigned'");
        expect(byType).toContain('excludeUnpublishedPicks: matchType === \'unassigned\'');
        expect(byType).toContain('excludeVoid: true');

        const db = fs.readFileSync(path.join(ROOT, 'apps/web/lib/db/matches.ts'), 'utf8');
        expect(db).toContain("row.tier === 'unassigned'");
        expect(db).toContain("startsWith('af-')");
        expect(db).toContain("m.matchType === 'free' || m.matchType === 'vip' || m.matchType === 'paid'");
        expect(db).toContain('Boolean(m.aiPrediction)');
        expect(db).toContain("fromDetails?.outcome === 'void' || fromSpread?.outcome === 'void'");
    });

    it('throws a typed ApiError for non-ok responses and missing configuration', async () => {
        enqueue({ error: 'bad request' }, 400);
        await expect(client.api.matches.byTypeAndDate('free', TODAY)).rejects.toMatchObject({
            code: 'http', status: 400, message: 'bad request',
        });

        process.env.EXPO_PUBLIC_API_URL = '';
        jest.resetModules();
        const unconfigured = require('../src/api/client') as typeof import('../src/api/client');
        expect(unconfigured.isApiConfigured).toBe(false);
        await expect(unconfigured.api.matches.byDate(TODAY)).rejects.toMatchObject({ code: 'config' });
    });
});
