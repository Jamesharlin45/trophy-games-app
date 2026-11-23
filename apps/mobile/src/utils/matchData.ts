/**
 * Pure data helpers for the match detail page and shared match rows.
 *
 * Every function is defensive: the web API may return odds/predictions with
 * missing or null fields, odds are STRINGS, and `new Date(match.timestamp)`
 * can be invalid. Helpers never throw and never return NaN/Infinity — they
 * return null/undefined or a clamped 0-100 number instead, so callers can
 * feed layout props without fear.
 *
 * Unit tests: `src/utils/matchData.bun.test.ts` (also picked up by jest).
 */

import type { MatchData } from '@trophy-games/shared';

export interface AiPredictionInput {
    prediction?: unknown;
    pick?: unknown;
    suggestedBet?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
    sources?: unknown;
    risk?: unknown;
}

export interface NormalizedAiPrediction {
    prediction?: string;
    pick?: string;
    suggestedBet?: string;
    confidence?: number;
    /** Non-empty strings only. */
    reasoning: string[];
    /** Non-empty, de-duplicated URLs. */
    sources: string[];
    risk?: 'low' | 'medium' | 'high';
}

export interface Odds13Input {
    home?: unknown;
    draw?: unknown;
    away?: unknown;
}

export interface NormalizedOdds13 {
    home?: string;
    draw?: string;
    away?: string;
}

export interface H2hHistoryRowInput {
    date?: unknown;
    league?: unknown;
    home?: unknown;
    away?: unknown;
    score?: unknown;
    outcome?: unknown;
}

export interface NormalizedH2hHistoryRow {
    date: string;
    league: string;
    home: string;
    away: string;
    score: string;
    outcome: string;
}

export interface StatRowInput {
    label?: unknown;
    home?: unknown;
    away?: unknown;
    percent?: unknown;
}

export interface NormalizedStatRow {
    label: string;
    home: number;
    away: number;
    percent?: boolean;
}

export interface LineupPlayerInput {
    name?: unknown;
    number?: unknown;
}

export interface NormalizedLineupPlayer {
    name: string;
    number?: number;
}

export interface DetailedOddsOuInput {
    over?: unknown;
    line?: unknown;
    under?: unknown;
}

export interface DetailedOddsAhInput {
    home?: unknown;
    line?: unknown;
    away?: unknown;
}

export interface DetailedOddsBlock {
    '1x2'?: Odds13Input;
    ou?: DetailedOddsOuInput;
    ah?: DetailedOddsAhInput;
}

export interface DetailedOddsInput {
    ft?: DetailedOddsBlock;
    ht?: DetailedOddsBlock;
}

export interface H2hInput {
    summary?: {
        wins?: unknown;
        draws?: unknown;
        losses?: unknown;
        [key: string]: unknown;
    };
    history?: unknown;
}

export interface NormalizedDetailedOdds {
    ft: {
        '1x2': { home: string; draw: string; away: string };
        ou?: { over: string; line: string; under: string };
        ah?: { home: string; line: string; away: string };
    };
    ht?: {
        '1x2': { home: string; draw: string; away: string };
        ou?: { over: string; line: string; under: string };
        ah?: { home: string; line: string; away: string };
    };
}

// ---------------------------------------------------------------------------
// Scalar coercion helpers
// ---------------------------------------------------------------------------

/** Finite number from a string/number, or null when invalid. */
export function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return null;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/** String from an unknown field — non-empty strings pass through. */
export function asString(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return undefined;
}

/** Odds parser: returns a number when the value is a finite odds > 0, else null. */
export function parseOdds(value: unknown): number | null {
    const n = toFiniteNumber(value);
    return n !== null && n > 0 ? n : null;
}

/** Confidence: numbers and numeric strings are clamped to 0–100; else undefined. */
export function parseConfidence(value: unknown): number | undefined {
    const n = toFiniteNumber(value);
    return n === null ? undefined : clampPercent(n);
}

/** Clamped 0–100 number — never NaN or out of range. */
export function clampPercent(value: number | string): number {
    const n = toFiniteNumber(value);
    if (n === null || Number.isNaN(n)) return 0;
    return Math.min(100, Math.max(0, n));
}

// ---------------------------------------------------------------------------
// Odds
// ---------------------------------------------------------------------------

/** Odds values as display strings ("1.77"); null/invalid fields are skipped. */
export function normalizedOdds(odds: Odds13Input | null | undefined): NormalizedOdds13 {
    return {
        home: asString(odds?.home),
        draw: asString(odds?.draw),
        away: asString(odds?.away),
    };
}

/** Sum of the valid odds of an 1x2 block; 0 when none are valid. */
export function marketTotal(odds: NormalizedOdds13 | Odds13Input | null | undefined): number {
    if (!odds) return 0;
    return (parseOdds(odds.home) ?? 0) + (parseOdds(odds.draw) ?? 0) + (parseOdds(odds.away) ?? 0);
}

/**
 * Implied probabilities: [home, draw, away] — only when all three odds are
 * valid numbers greater than 1. Otherwise null (hide the market view).
 */
export function impliedProbabilities(
    odds: NormalizedOdds13,
): [number, number, number] | null {
    const h = parseOdds(odds.home);
    const x = parseOdds(odds.draw);
    const a = parseOdds(odds.away);
    if (h === null || x === null || a === null) return null;
    if (h <= 1 || x <= 1 || a <= 1) return null;
    return [(1 / h) * 100, (1 / x) * 100, (1 / a) * 100];
}

// ---------------------------------------------------------------------------
// AI prediction
// ---------------------------------------------------------------------------

/** First non-empty pick/suggestedBet/prediction, or undefined. */
export function pickTextFrom(ai: AiPredictionInput | null | undefined): string | undefined {
    return asString(ai?.pick) ?? asString(ai?.suggestedBet) ?? asString(ai?.prediction);
}

/** Normalized reasoning lines (non-empty strings, deduplicated, first 5 kept later by caller). */
export function reasoningLines(ai: AiPredictionInput | null | undefined): string[] {
    if (!Array.isArray(ai?.reasoning)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of ai.reasoning) {
        const text = asString(item);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

/** Normalized source URLs (non-empty strings, deduplicated). */
export function sourceUrls(ai: AiPredictionInput | null | undefined): string[] {
    if (!Array.isArray(ai?.sources)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of ai.sources) {
        const url = asString(item);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
    }
    return out;
}

export function riskOf(ai: AiPredictionInput | null | undefined): 'low' | 'medium' | 'high' | undefined {
    const risk = ai?.risk;
    return risk === 'low' || risk === 'medium' || risk === 'high' ? risk : undefined;
}

/** Fully normalized prediction — every field is null-safe. */
export function normalizeAiPrediction(ai: AiPredictionInput | null | undefined): NormalizedAiPrediction | undefined {
    if (ai === null || ai === undefined) return undefined;
    return {
        prediction: asString(ai.prediction),
        pick: asString(ai.pick),
        suggestedBet: asString(ai.suggestedBet),
        confidence: parseConfidence(ai.confidence),
        reasoning: reasoningLines(ai),
        sources: sourceUrls(ai),
        risk: riskOf(ai),
    };
}

// ---------------------------------------------------------------------------
// Match status / results
// ---------------------------------------------------------------------------

export function isFinishedStatus(status: unknown): boolean {
    return status === 'Finished' || status === 'FT' || status === 'AET' || status === 'PEN';
}

/** History rule: FINISHED matches (status or a real result) are always unlocked. */
export function isFinishedMatch(match: { status?: unknown; result?: unknown } | null | undefined): boolean {
    if (!match) return false;
    if (isFinishedStatus(match.status)) return true;
    return match.result !== undefined && match.result !== null && match.result !== 'pending';
}

export function isLiveMatch(status: unknown): boolean {
    if (typeof status !== 'string') return false;
    return status.includes('Live') || status === 'Halftime' || status === 'HT';
}

export function isPostponedMatch(status: unknown): boolean {
    if (typeof status !== 'string') return false;
    return status === 'PST' || status.toLowerCase().includes('postpon');
}

// ---------------------------------------------------------------------------
// Time / domain helpers
// ---------------------------------------------------------------------------

export function formatTime(date: Date | null | undefined): string {
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(date: Date | null | undefined): string {
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' });
}

export function parseTimestamp(value: unknown): Date {
    const n = toFiniteNumber(value);
    if (n !== null) return new Date(n);
    if (typeof value === 'string' && value.trim() !== '') {
        const d = new Date(value);
        return d;
    }
    return new Date(0);
}

export function domainOf(url: unknown): string {
    if (typeof url !== 'string' || url.trim() === '') return '';
    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        host = url.replace(/^https?:\/\//, '').split('/')[0];
    }
    return host.replace(/^www\./, '');
}

// ---------------------------------------------------------------------------
// Rich detail data (h2h, stats, lineups, potentials)
// ---------------------------------------------------------------------------

export function normalizeH2h(h2h: H2hInput | null | undefined): {
    summary?: { wins: number; draws: number; losses: number };
    history?: NormalizedH2hHistoryRow[];
} {
    if (!h2h) return {};
    const summary =
        h2h.summary == null
            ? undefined
            : {
                  wins: toFiniteNumber(h2h.summary.wins) ?? 0,
                  draws: toFiniteNumber(h2h.summary.draws) ?? 0,
                  losses: toFiniteNumber(h2h.summary.losses) ?? 0,
              };
    const history = Array.isArray(h2h.history)
        ? h2h.history.map((row) => ({
              date: asString((row as H2hHistoryRowInput)?.date) ?? '',
              league: asString((row as H2hHistoryRowInput)?.league) ?? '',
              home: asString((row as H2hHistoryRowInput)?.home) ?? '',
              away: asString((row as H2hHistoryRowInput)?.away) ?? '',
              score: asString((row as H2hHistoryRowInput)?.score) ?? '',
              outcome: asString((row as H2hHistoryRowInput)?.outcome) ?? '',
          }))
        : undefined;
    return { summary, history };
}

export function normalizeStats(stats: unknown): NormalizedStatRow[] {
    if (!Array.isArray(stats)) return [];
    const out: NormalizedStatRow[] = [];
    for (const row of stats) {
        if (typeof row !== 'object' || row === null) continue;
        const { home, away, label, percent } = row as StatRowInput;
        const homeN = toFiniteNumber(home);
        const awayN = toFiniteNumber(away);
        if (homeN === null || awayN === null) continue;
        out.push({
            label: asString(label) ?? '',
            home: homeN,
            away: awayN,
            percent: percent === true ? true : undefined,
        });
    }
    return out;
}

export function normalizeLineups(
    players: unknown,
): NormalizedLineupPlayer[] {
    if (!Array.isArray(players)) return [];
    const out: NormalizedLineupPlayer[] = [];
    for (const p of players) {
        const name = asString(p?.name);
        if (!name) continue;
        const number = toFiniteNumber(p?.number);
        out.push({ name, number: number === null ? undefined : number });
    }
    return out;
}

export function normalizeDetailedOdds(
    detailedOdds: DetailedOddsInput | null | undefined,
): NormalizedDetailedOdds | undefined {
    if (!detailedOdds) return undefined;
    const normOu = (ou: DetailedOddsOuInput | undefined) =>
        ou
            ? {
                  over: asString(ou.over) ?? '',
                  line: asString(ou.line) ?? '',
                  under: asString(ou.under) ?? '',
              }
            : undefined;
    const normAh = (ah: DetailedOddsAhInput | undefined) =>
        ah
            ? {
                  home: asString(ah.home) ?? '',
                  line: asString(ah.line) ?? '',
                  away: asString(ah.away) ?? '',
              }
            : undefined;
    const norm1x2 = (o: Odds13Input | undefined) => ({
        home: asString(o?.home) ?? '',
        draw: asString(o?.draw) ?? '',
        away: asString(o?.away) ?? '',
    });
    const ft = detailedOdds.ft;
    const ht = detailedOdds.ht;
    return {
        ft: {
            '1x2': ft ? norm1x2(ft['1x2']) : { home: '', draw: '', away: '' },
            ...(ft?.ou ? { ou: normOu(ft.ou) } : {}),
            ...(ft?.ah ? { ah: normAh(ft.ah) } : {}),
        },
        ...(ht ? { ht: { '1x2': norm1x2(ht['1x2']) } } : {}),
    };
}

// ---------------------------------------------------------------------------
// Form / potentials / scores
// ---------------------------------------------------------------------------

/** First ≤5 of a form string ("WWL"); '' when missing or invalid. */
export function formString(value: unknown): string {
    const text = asString(value);
    if (!text) return '';
    return text.slice(0, 5);
}

/** xG values — clamped to 0–100, 0 when missing or invalid. */
export function xgOf(value: unknown): number {
    return clampPercent(toFiniteNumber(value) ?? 0);
}

/** Potentials rows (predicted probabilities) — null-safe. */
export function normalizePotentials(
    potentials: MatchData['potentials'] | null | undefined,
): Array<{ label: string; percent?: number; value?: string }> {
    if (!Array.isArray(potentials)) return [];
    const out: Array<{ label: string; percent?: number; value?: string }> = [];
    for (const p of potentials) {
        const label = asString(p?.label);
        const percentRaw = toFiniteNumber(p?.percent);
        out.push({
            label: label ?? '',
            percent: percentRaw === null ? undefined : clampPercent(percentRaw),
            value: asString(p?.value),
        });
    }
    return out;
}

/** Score-line text for the header, or '' when missing. */
export function scoreText(homeScore: unknown, awayScore: unknown): string {
    const home = toFiniteNumber(homeScore);
    const away = toFiniteNumber(awayScore);
    if (home === null || away === null) return '';
    return `${home} - ${away}`;
}

/** Share URL for the match page (guarded). */
export function shareUrlFor(matchId: unknown): string {
    const id = asString(matchId) ?? '';
    return `trophy-games://match/${id}`;
}
