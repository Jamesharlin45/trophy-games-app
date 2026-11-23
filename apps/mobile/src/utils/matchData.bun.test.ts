/**
 * Pure-function unit tests for the match-page data helpers (src/utils/matchData.ts).
 * Run with bun: `bun test src/utils/matchData.bun.test.ts` (picked up by jest too).
 */

import {
    asString,
    clampPercent,
    domainOf,
    formatDate,
    formatTime,
    formString,
    impliedProbabilities,
    isFinishedMatch,
    isFinishedStatus,
    isLiveMatch,
    isPostponedMatch,
    marketTotal,
    normalizeAiPrediction,
    normalizeDetailedOdds,
    normalizeH2h,
    normalizeLineups,
    normalizePotentials,
    normalizeStats,
    parseConfidence,
    parseOdds,
    parseTimestamp,
    pickTextFrom,
    reasoningLines,
    riskOf,
    scoreText,
    shareUrlFor,
    sourceUrls,
    toFiniteNumber,
    xgOf,
} from './matchData';

// --- toFiniteNumber / asString / clampPercent ---

describe('toFiniteNumber', () => {
    it('accepts finite numbers and numeric strings', () => {
        expect(toFiniteNumber(3)).toBe(3);
        expect(toFiniteNumber('3.15')).toBe(3.15);
        expect(toFiniteNumber(' 2 ')).toBe(2);
    });
    it('rejects invalid input', () => {
        expect(toFiniteNumber(undefined)).toBeNull();
        expect(toFiniteNumber(null)).toBeNull();
        expect(toFiniteNumber('')).toBeNull();
        expect(toFiniteNumber('abc')).toBeNull();
        expect(toFiniteNumber(NaN)).toBeNull();
        expect(toFiniteNumber(Infinity)).toBeNull();
    });
});

describe('asString', () => {
    it('passes through non-empty strings', () => {
        expect(asString('a')).toBe('a');
        expect(asString(5)).toBe('5');
    });
    it('drops empty/undefined/non-string values', () => {
        expect(asString('')).toBeUndefined();
        expect(asString('  ')).toBeUndefined();
        expect(asString(undefined)).toBeUndefined();
        expect(asString(null)).toBeUndefined();
        expect(asString(true)).toBeUndefined();
    });
});

describe('clampPercent', () => {
    it('clamps to 0-100 and handles invalid input', () => {
        expect(clampPercent(120)).toBe(100);
        expect(clampPercent(-5)).toBe(0);
        expect(clampPercent(50)).toBe(50);
        expect(clampPercent(NaN)).toBe(0);
        expect(clampPercent(Infinity)).toBe(0);
        expect(clampPercent('30')).toBe(30);
    });
});

// --- odds ---

describe('parseOdds', () => {
    it('accepts valid odds', () => {
        expect(parseOdds('1.77')).toBe(1.77);
        expect(parseOdds(2.5)).toBe(2.5);
    });
    it('rejects invalid odds (0, negative, empty, garbage)', () => {
        expect(parseOdds(0)).toBeNull();
        expect(parseOdds('0')).toBeNull();
        expect(parseOdds('')).toBeNull();
        expect(parseOdds('abc')).toBeNull();
        expect(parseOdds(undefined)).toBeNull();
    });
});

describe('marketTotal + impliedProbabilities', () => {
    it('sums valid odds and ignores invalid ones', () => {
        expect(marketTotal({ home: '2.5', draw: '', away: '1.5' })).toBe(4);
        expect(marketTotal({ home: 'a', draw: undefined, away: null })).toBe(0);
    });
    it('implied probabilities only when all three valid and > 1', () => {
        const p = impliedProbabilities({ home: '2', draw: '4', away: '2' });
        expect(p).toEqual([50, 25, 50]);
        // One invalid (draw < 1) → null
        expect(impliedProbabilities({ home: '2', draw: '0.5', away: '2' })).toBeNull();
        // One missing → null
        expect(impliedProbabilities({ home: '2', draw: undefined, away: '2' })).toBeNull();
    });
});

describe('parseConfidence', () => {
    it('clamps numbers and numeric strings', () => {
        expect(parseConfidence(68)).toBe(68);
        expect(parseConfidence('68')).toBe(68);
        expect(parseConfidence(120)).toBe(100);
        expect(parseConfidence(-5)).toBe(0);
    });
    it('returns undefined for invalid values', () => {
        expect(parseConfidence(undefined)).toBeUndefined();
        expect(parseConfidence(null)).toBeUndefined();
        expect(parseConfidence('abc')).toBeUndefined();
    });
});

// --- aiPrediction helpers ---

describe('normalizeAiPrediction + pickTextFrom + reasoningLines + sourceUrls + riskOf', () => {
    it('normalizes a full prediction', () => {
        const p = normalizeAiPrediction({
            prediction: 'Home wins',
            pick: 'HOME',
            confidence: 85,
            reasoning: ['a', '', 'b', 'a'],
            sources: ['https://x.com/a', 'https://x.com/a', 'not-a-url', ''],
            risk: 'medium',
            suggestedBet: '1',
        });
        expect(p).toEqual({
            prediction: 'Home wins',
            pick: 'HOME',
            confidence: 85,
            reasoning: ['a', 'b'],
            // asString keeps any non-empty string; '' and undefined are dropped.
            sources: ['https://x.com/a', 'not-a-url'],
            risk: 'medium',
            suggestedBet: '1',
        });
        expect(pickTextFrom(p)).toBe('HOME');
    });
    it('returns undefined for null/missing predictions', () => {
        expect(normalizeAiPrediction(null)).toBeUndefined();
        expect(normalizeAiPrediction(undefined)).toBeUndefined();
    });
    it('pickTextFrom falls back pick → suggestedBet → prediction', () => {
        expect(pickTextFrom({ prediction: 'X' })).toBe('X');
        expect(pickTextFrom({ suggestedBet: 'Y', prediction: 'X' })).toBe('Y');
        expect(pickTextFrom({})).toBeUndefined();
        expect(pickTextFrom(null)).toBeUndefined();
    });
    it('normalizeAiPrediction guards missing fields', () => {
        const p = normalizeAiPrediction({ prediction: 'Home wins', confidence: null, reasoning: 'not-array', sources: [42] });
        expect(p).toMatchObject({ prediction: 'Home wins', reasoning: [], sources: ['42'] });
        expect(p?.confidence).toBeUndefined();
    });
    it('riskOf only accepts valid risk values', () => {
        expect(riskOf({ risk: 'low' })).toBe('low');
        expect(riskOf({ risk: 'nope' })).toBeUndefined();
        expect(riskOf(null)).toBeUndefined();
    });
});

// --- status/result ---

describe('isFinishedStatus / isFinishedMatch', () => {
    it('isFinishedStatus matches the documented vocabulary', () => {
        expect(isFinishedStatus('Finished')).toBe(true);
        expect(isFinishedStatus('FT')).toBe(true);
        expect(isFinishedStatus('AET')).toBe(true);
        expect(isFinishedStatus('PEN')).toBe(true);
        expect(isFinishedStatus('Upcoming')).toBe(false);
        expect(isFinishedStatus(null)).toBe(false);
        expect(isFinishedStatus(undefined)).toBe(false);
    });
    it('isFinishedMatch is null-safe and covers results', () => {
        expect(isFinishedMatch(null)).toBe(false);
        expect(isFinishedMatch(undefined)).toBe(false);
        expect(isFinishedMatch({ status: 'Upcoming', result: undefined })).toBe(false);
        expect(isFinishedMatch({ status: 'FT' })).toBe(true);
        expect(isFinishedMatch({ status: 'Upcoming', result: 'win' })).toBe(true);
        expect(isFinishedMatch({ status: 'Upcoming', result: 'lose' })).toBe(true);
        expect(isFinishedMatch({ status: 'Upcoming', result: 'draw' })).toBe(true);
        expect(isFinishedMatch({ status: 'Upcoming', result: 'void' })).toBe(true);
        expect(isFinishedMatch({ status: 'Upcoming', result: 'pending' })).toBe(false);
        expect(isFinishedMatch({ status: 'Upcoming', result: null })).toBe(false);
    });
});

describe('isLiveMatch / isPostponedMatch', () => {
    it('recognizes live statuses, null-safe', () => {
        expect(isLiveMatch('Live 1-0')).toBe(true);
        expect(isLiveMatch('Halftime')).toBe(true);
        expect(isLiveMatch('HT')).toBe(true);
        expect(isLiveMatch('Upcoming')).toBe(false);
        expect(isLiveMatch(null)).toBe(false);
    });
    it('recognizes postponed statuses, null-safe', () => {
        expect(isPostponedMatch('PST')).toBe(true);
        expect(isPostponedMatch('Postponed')).toBe(true);
        expect(isPostponedMatch('Upcoming')).toBe(false);
        expect(isPostponedMatch(null)).toBe(false);
    });
});

// --- dates / domains ---

describe('formatTime / formatDate / parseTimestamp / domainOf', () => {
    it('formats valid dates', () => {
        expect(formatTime(new Date(2026, 10, 30, 19, 5))).toBe(
            new Date(2026, 10, 30, 19, 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        );
        expect(formatDate(new Date(2026, 10, 30))).toBe(
            new Date(2026, 10, 30).toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' }),
        );
    });
    it('returns empty strings for invalid dates', () => {
        expect(formatTime(new Date('not a date'))).toBe('');
        expect(formatDate(undefined)).toBe('');
        expect(formatTime(null)).toBe('');
    });
    it('parseTimestamp never returns an invalid Date', () => {
        expect(parseTimestamp('2026-11-30T19:00:00Z').getTime()).not.toBeNaN();
        expect(parseTimestamp(undefined).getTime()).toBe(0);
        expect(parseTimestamp(null).getTime()).toBe(0);
    });
    it('domainOf strips protocol and www, null-safe', () => {
        expect(domainOf('https://www.example.com/analysis')).toBe('example.com');
        expect(domainOf('example.com/x')).toBe('example.com');
        expect(domainOf('')).toBe('');
        expect(domainOf(undefined)).toBe('');
        expect(domainOf(null)).toBe('');
    });
});

// --- rich detail data ---

describe('normalizeH2h', () => {
    it('normalizes summary and history, null-safe', () => {
        const out = normalizeH2h({
            summary: { wins: 3, draws: 1, losses: 2, total: 6 },
            history: [{ date: '2026-10-01', league: 'L', home: 'A', away: 'B', score: '1-0', outcome: 'W' }],
        });
        expect(out.summary).toEqual({ wins: 3, draws: 1, losses: 2 });
        expect(out.history).toEqual([{ date: '2026-10-01', league: 'L', home: 'A', away: 'B', score: '1-0', outcome: 'W' }]);
    });
    it('handles missing/garbage input', () => {
        expect(normalizeH2h(null)).toEqual({});
        expect(normalizeH2h(undefined)).toEqual({});
        expect(normalizeH2h({}).summary).toBeUndefined();
        expect(normalizeH2h({ summary: { wins: 'x', draws: null, losses: 2 } }).summary).toEqual({ wins: 0, draws: 0, losses: 2 });
    });
});

describe('normalizeStats', () => {
    it('normalizes rows, dropping invalid ones', () => {
        const rows = normalizeStats([
            { label: 'Possession', home: 60, away: 40, percent: true },
            { label: 'Shots', home: '10', away: 5 },
            { label: 'Bad', home: NaN, away: 1 },
            { label: 'No label', home: 1, away: 0 },
        ]);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual({ label: 'Possession', home: 60, away: 40, percent: true });
    });
    it('returns [] for null/invalid', () => {
        expect(normalizeStats(null)).toEqual([]);
        expect(normalizeStats(undefined)).toEqual([]);
        expect(normalizeStats('nope' as unknown as never)).toEqual([]);
    });
});

describe('normalizeLineups', () => {
    it('keeps valid players with numbers', () => {
        const out = normalizeLineups([{ name: 'Alice', number: 10 }, { name: 'Bob' }, { name: '' }]);
        expect(out).toEqual([{ name: 'Alice', number: 10 }, { name: 'Bob', number: undefined }]);
    });
    it('returns [] for null/invalid', () => {
        expect(normalizeLineups(null)).toEqual([]);
        expect(normalizeLineups('nope')).toEqual([]);
    });
});

describe('normalizeDetailedOdds', () => {
    it('normalizes 1x2/OU/AH, null-safe', () => {
        const out = normalizeDetailedOdds({
            ft: { '1x2': { home: '1.77', draw: '3.15', away: '2.2' }, ou: { over: '2.25', line: '2.25', under: '1.72' }, ah: { home: '1.05', line: '-0.5', away: '1.1' } },
            ht: { '1x2': { home: '1.5', draw: '3.4', away: '2.1' } },
        });
        expect(out?.ft['1x2']).toEqual({ home: '1.77', draw: '3.15', away: '2.2' });
        expect(out?.ft.ou?.line).toBe('2.25');
        expect(out?.ht?.['1x2']?.away).toBe('2.1');
        expect(out?.ht?.ou).toBeUndefined();
    });
    it('normalizes empty strings when fields are missing', () => {
        const out = normalizeDetailedOdds({ ft: { '1x2': { home: '1.7' } } });
        expect(out?.ft['1x2']).toEqual({ home: '1.7', draw: '', away: '' });
    });
    it('returns undefined for null/missing', () => {
        expect(normalizeDetailedOdds(null)).toBeUndefined();
        expect(normalizeDetailedOdds(undefined)).toBeUndefined();
    });
});

describe('formString / xgOf / normalizePotentials / scoreText / shareUrlFor', () => {
    it('formString takes first 5 chars', () => {
        expect(formString('WWDLLW')).toBe('WWDLL');
        expect(formString('WW')).toBe('WW');
        expect(formString('')).toBe('');
        expect(formString(undefined)).toBe('');
        expect(formString(null)).toBe('');
    });
    it('xgOf clamps and defaults to 0', () => {
        expect(xgOf(2.5)).toBe(2.5);
        expect(xgOf('1.5')).toBe(1.5);
        expect(xgOf(-1)).toBe(0);
        expect(xgOf(undefined)).toBe(0);
        expect(xgOf('abc')).toBe(0);
    });
    it('normalizePotentials clamps percent, drops unparseable percent', () => {
        const out = normalizePotentials([
            { label: 'Win', percent: 70, value: undefined },
            { label: '', percent: -5 },
            { label: 'Lose', percent: 'not-number' as unknown as number, value: '2' },
        ]);
        expect(out).toHaveLength(3);
        expect(out[0]).toMatchObject({ label: 'Win', percent: 70 });
        // Negative clamps to 0.
        expect(out[1]).toMatchObject({ percent: 0 });
        // Unparseable percent → undefined; value preserved.
        expect(out[2]).toMatchObject({ label: 'Lose', value: '2' });
        expect(out[2]?.percent).toBeUndefined();
    });
    it('scoreText formats numeric scores', () => {
        expect(scoreText(3, 1)).toBe('3 - 1');
        expect(scoreText(undefined, null)).toBe('');
        expect(scoreText('x', 1)).toBe('');
    });
    it('shareUrlFor builds the scheme URL from a valid id', () => {
        expect(shareUrlFor('m-1')).toBe('trophy-games://match/m-1');
        expect(shareUrlFor(undefined)).toBe('trophy-games://match/');
    });
});

// reasoningLines / sourceUrls — re-export coverage (already tested via normalizeAiPrediction)
describe('reasoningLines / sourceUrls direct', () => {
    it('dedupes and drops invalid entries', () => {
        expect(reasoningLines({ reasoning: ['a', 'a', '', null, 'b'] })).toEqual(['a', 'b']);
        expect(sourceUrls({ sources: ['https://a.com', 'https://a.com', '', 42] })).toEqual(['https://a.com', '42']);
    });
});
