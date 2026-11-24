/**
 * No-network tests for the app mapping layer (A): lib/db/matches.ts
 * mapMatch + toAppResult + isVoidOutcome. These run offline against
 * synthetic MatchRow values — the live-data validator is
 * scripts/validate-app-data.ts.
 * Run with: bun apps/web/scripts/test-app-data.ts
 */
import { mapMatch, toAppResult, isVoidOutcome } from '../lib/db/matches';
import type { AiPrediction, MatchOdds, MatchRow } from '../lib/db/types';

function baseRow(overrides: Partial<MatchRow>): MatchRow {
    return {
        id: 'row-1',
        home_team: 'Home FC',
        away_team: 'Away FC',
        league: 'League',
        kickoff: '2026-11-24T13:45:00Z',
        score: '2-1',
        status: 'FT',
        result: 'win',
        tier: 'paid',
        odds: null,
        trending: false,
        is_history: false,
        match_date: '2026-11-24',
        ai_prediction: null,
        external_id: 'ext-1',
        details: null,
        ...overrides,
    };
}

let passed = 0;
const failures: string[] = [];

/** Order-insensitive JSON comparison — object key order is not a contract. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
}

function check(actual: unknown, expected: unknown, note: string): void {
    if (canonical(actual) === canonical(expected)) {
        passed += 1;
        console.log(`PASS  ${note}`);
    } else {
        failures.push(
            `FAIL  ${note}: expected ${canonical(expected)}, got ${canonical(actual)}`,
        );
        console.error(failures[failures.length - 1]);
    }
}

// --- toAppResult: app vocabulary is always pending | win | lose | draw ----
check(toAppResult('win'), 'win', 'toAppResult(win)');
check(toAppResult('lose'), 'lose', 'toAppResult(lose)');
check(toAppResult('draw'), 'draw', 'toAppResult(draw)');
check(toAppResult(null), 'pending', 'toAppResult(null) -> pending');
check(toAppResult(undefined), 'pending', 'toAppResult(undefined) -> pending');
check(toAppResult('void'), 'pending', "toAppResult('void') -> pending (void is not in the app vocabulary)");

// --- mapMatch: result is always pending | win | lose | draw ----------------
check(mapMatch(baseRow({})).result, 'win', 'mapMatch result win');
check(mapMatch(baseRow({ result: null })).result, 'pending', 'mapMatch result null -> pending');
check(mapMatch(baseRow({ result: undefined })).result, 'pending', 'mapMatch result undefined -> pending');
check(
    mapMatch(baseRow({ result: 'void' as MatchRow['result'] })).result,
    'pending',
    "mapMatch result 'void' -> pending",
);

// --- isVoidOutcome ---------------------------------------------------------
check(isVoidOutcome({ details: { settlement: { outcome: 'void' } } }), true, 'isVoidOutcome(settlement void)');
check(isVoidOutcome({ details: { settlement: { outcome: 'won' } } }), false, 'isVoidOutcome(settlement won)');
check(isVoidOutcome({ details: null }), false, 'isVoidOutcome(null details)');
check(isVoidOutcome({ details: undefined }), false, 'isVoidOutcome(undefined details)');
check(isVoidOutcome({ details: { other: true } }), false, 'isVoidOutcome(no settlement)');

// --- mapMatch + isVoidOutcome: void rows are detectable via details -------
const voidRow = mapMatch(
    baseRow({ result: null, details: { settlement: { outcome: 'void', status: 'AET' } } }),
);
check(isVoidOutcome(voidRow), true, 'isVoidOutcome(mapped void row)');
check(voidRow.result, 'pending', 'mapped void row result is pending');

// --- mapMatch: aiPrediction normalization ---------------------------------
const fullPrediction = mapMatch(
    baseRow({
        ai_prediction: {
            prediction: 'Home Win',
            confidence: 68,
            reasoning: ['first line', 'second line'],
            generatedAt: '2026-11-23T04:49:04.181Z',
        },
    }),
);
check(fullPrediction.aiPrediction?.prediction, 'Home Win', 'aiPrediction.prediction kept');
check(fullPrediction.aiPrediction?.confidence, 68, 'aiPrediction.confidence kept');
check(fullPrediction.aiPrediction?.reasoning, ['first line', 'second line'], 'aiPrediction.reasoning kept');

const malformedPrediction = mapMatch(
    baseRow({
        ai_prediction: {
            prediction: null,
            confidence: 'high',
            reasoning: 'not-an-array',
            generatedAt: '2026-11-23T04:49:04.181Z',
        } as unknown as AiPrediction,
    }),
);
check(malformedPrediction.aiPrediction?.prediction, '', 'aiPrediction.prediction null -> ""');
check(malformedPrediction.aiPrediction?.confidence, 0, 'aiPrediction.confidence non-number -> 0');
check(malformedPrediction.aiPrediction?.reasoning, [], 'aiPrediction.reasoning non-array -> []');

// --- mapMatch: score 'H-A' -------------------------------------------------
check(mapMatch(baseRow({ score: '2-1' })).score, '2-1', 'score "2-1" -> "2-1"');
check(mapMatch(baseRow({ score: null as unknown as string })).score, '-', 'score null -> "-"');
check(mapMatch(baseRow({ score: '0-0' })).score, '0-0', 'score "0-0" -> "0-0"');

// --- mapMatch: odds are an object of numbers -------------------------------
const numericOdds = mapMatch(baseRow({ odds: { home: 1.65, draw: 1.38, away: 4.22 } }));
check(numericOdds.odds, { home: 1.65, draw: 1.38, away: 4.22 }, 'numeric odds pass through');

const stringOdds = mapMatch(
    baseRow({ odds: { home: '1.65', draw: '1.38', away: '4.22' } as unknown as MatchOdds }),
);
check(stringOdds.odds, { home: 1.65, draw: 1.38, away: 4.22 }, 'string odds coerced to numbers');

const missingOdds = mapMatch(baseRow({ odds: null }));
check(missingOdds.odds, undefined, 'null odds stay absent');

const partialOdds = mapMatch(baseRow({ odds: { home: 2.5, away: 3.1 } as unknown as MatchOdds }));
check(partialOdds.odds, { home: 2.5, away: 3.1 }, 'odds without draw keep no draw key');

// --- mapMatch: null strings become '' --------------------------------------
check(mapMatch(baseRow({ home_team: null as unknown as string })).homeTeam, '', 'homeTeam null -> ""');
check(mapMatch(baseRow({ away_team: null as unknown as string })).awayTeam, '', 'awayTeam null -> ""');
check(mapMatch(baseRow({ league: null as unknown as string })).league, '', 'league null -> ""');
check(mapMatch(baseRow({ status: null as unknown as string })).status, '', 'status null -> ""');
check(mapMatch(baseRow({ kickoff: null as unknown as string })).timestamp, '', 'timestamp null -> ""');

console.log(`\n${passed} checks passed${failures.length > 0 ? `, ${failures.length} failed` : ''}.`);
if (failures.length > 0) process.exit(1);
console.log('All app data mapping tests passed.');
