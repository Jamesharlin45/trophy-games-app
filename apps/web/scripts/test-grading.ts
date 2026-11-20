/**
 * No-network tests for pick grading (lib/settle.ts).
 * Run with: bun apps/web/scripts/test-grading.ts
 */
import { gradePick, type SettlementOutcome } from '../lib/settle';

interface Case {
    market: string;
    home: number;
    away: number;
    expected: SettlementOutcome | null;
    note: string;
}

const cases: Case[] = [
    // Home Win
    { market: 'Home Win', home: 2, away: 1, expected: 'won', note: 'home win' },
    { market: 'Home Win', home: 1, away: 1, expected: 'lost', note: 'draw loses' },
    { market: 'Home Win', home: 0, away: 2, expected: 'lost', note: 'away win loses' },

    // Away Win
    { market: 'Away Win', home: 0, away: 2, expected: 'won', note: 'away win' },
    { market: 'Away Win', home: 1, away: 1, expected: 'lost', note: 'draw loses' },
    { market: 'Away Win', home: 2, away: 1, expected: 'lost', note: 'home win loses' },

    // Draw
    { market: 'Draw', home: 1, away: 1, expected: 'won', note: '1-1 draw' },
    { market: 'Draw', home: 0, away: 0, expected: 'won', note: '0-0 draw' },
    { market: 'Draw', home: 2, away: 1, expected: 'lost', note: 'decisive result loses' },

    // Double Chance 1X
    { market: 'Double Chance 1X', home: 2, away: 1, expected: 'won', note: 'home win' },
    { market: 'Double Chance 1X', home: 1, away: 1, expected: 'won', note: 'draw' },
    { market: 'Double Chance 1X', home: 0, away: 2, expected: 'lost', note: 'away win loses' },

    // Double Chance X2
    { market: 'Double Chance X2', home: 0, away: 2, expected: 'won', note: 'away win' },
    { market: 'Double Chance X2', home: 1, away: 1, expected: 'won', note: 'draw' },
    { market: 'Double Chance X2', home: 2, away: 1, expected: 'lost', note: 'home win loses' },

    // Over 2.5 — boundary is 3 goals
    { market: 'Over 2.5 Goals', home: 2, away: 1, expected: 'won', note: '3 goals (over boundary)' },
    { market: 'Over 2.5 Goals', home: 1, away: 1, expected: 'lost', note: '2 goals (under boundary)' },
    { market: 'Over 2.5 Goals', home: 0, away: 0, expected: 'lost', note: '0-0' },
    { market: 'Over 2.5 Goals', home: 3, away: 2, expected: 'won', note: '5 goals' },

    // Under 2.5 — boundary is 2 goals
    { market: 'Under 2.5 Goals', home: 1, away: 1, expected: 'won', note: '2 goals (under boundary)' },
    { market: 'Under 2.5 Goals', home: 0, away: 0, expected: 'won', note: '0-0' },
    { market: 'Under 2.5 Goals', home: 2, away: 1, expected: 'lost', note: '3 goals (over boundary)' },
    { market: 'Under 2.5 Goals', home: 3, away: 2, expected: 'lost', note: '5 goals' },

    // Both Teams To Score
    { market: 'Both Teams To Score', home: 1, away: 1, expected: 'won', note: 'both scored' },
    { market: 'Both Teams To Score', home: 2, away: 1, expected: 'won', note: 'both scored' },
    { market: 'Both Teams To Score', home: 1, away: 0, expected: 'lost', note: 'away did not score' },
    { market: 'Both Teams To Score', home: 0, away: 0, expected: 'lost', note: '0-0' },

    // Extra time: grading always uses the 90-minute score. A 1-1 game that
    // ends 2-1 after extra time must still win a Draw / Under 2.5 pick.
    { market: 'Draw', home: 1, away: 1, expected: 'won', note: 'AET: 90-min 1-1 is a draw' },
    { market: 'Under 2.5 Goals', home: 1, away: 1, expected: 'won', note: 'AET: 90-min 2 goals' },
    { market: 'Home Win', home: 1, away: 1, expected: 'lost', note: 'AET: 90-min draw loses home win' },

    // Market parsing: case and extra whitespace are ignored.
    { market: '  home   WIN ', home: 3, away: 0, expected: 'won', note: 'normalized market' },
    { market: 'OVER 2.5 GOALS', home: 2, away: 1, expected: 'won', note: 'uppercase market' },

    // Unknown market cannot be graded.
    { market: 'Correct Score 3-0', home: 3, away: 0, expected: null, note: 'unsupported market' },
];

let passed = 0;
const failures: string[] = [];

for (const testCase of cases) {
    const actual = gradePick(testCase.market, testCase.home, testCase.away);
    if (actual === testCase.expected) {
        passed += 1;
        console.log(
            `PASS  ${testCase.market.padEnd(22)} ${testCase.home}-${testCase.away}  -> ${String(actual).padEnd(5)} (${testCase.note})`,
        );
    } else {
        const message = `FAIL  ${testCase.market} ${testCase.home}-${testCase.away} expected ${String(testCase.expected)} got ${String(actual)} (${testCase.note})`;
        failures.push(message);
        console.log(message);
    }
}

console.log(`\n${passed}/${cases.length} passed`);
if (failures.length > 0) {
    console.error(`${failures.length} failed`);
    process.exit(1);
}
console.log('All grading tests passed.');
