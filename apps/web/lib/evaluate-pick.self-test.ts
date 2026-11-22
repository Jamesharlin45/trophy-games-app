/**
 * Self-test for evaluatePick. Runnable with bun:
 *
 *     cd apps/web && bun lib/evaluate-pick.self-test.ts
 *
 * Exits non-zero when any case fails.
 */

import { evaluatePick } from './evaluate-pick';

interface Case {
    pick: string | null | undefined;
    homeName: string;
    awayName: string;
    homeGoals: number | null | undefined;
    awayGoals: number | null | undefined;
    expected: 'won' | 'lost' | 'void' | null;
}

const CASES: Case[] = [
    // Classic 1X2 picks.
    { pick: 'Home win', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'won' },
    { pick: 'Home win', homeName: 'Home', awayName: 'Away', homeGoals: 0, awayGoals: 1, expected: 'lost' },
    { pick: 'Away win', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 2, expected: 'won' },
    { pick: 'Draw', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'won' },
    { pick: 'Draw', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'lost' },
    { pick: '1', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'won' },
    { pick: '1', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 3, expected: 'lost' },
    { pick: '2', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 2, expected: 'won' },
    { pick: '2', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'lost' },
    { pick: 'X', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'won' },
    { pick: 'X', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 0, expected: 'lost' },
    { pick: 'X', homeName: 'Home', awayName: 'Away', homeGoals: 3, awayGoals: 3, expected: 'won' },
    { pick: 'Home', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 0, expected: 'won' },
    { pick: 'Away', homeName: 'Home', awayName: 'Away', homeGoals: 0, awayGoals: 3, expected: 'won' },

    // Team-name picks: "<TeamName> to win".
    { pick: 'Al Ahly to win', homeName: 'Al Ahly', awayName: 'Zamalek', homeGoals: 2, awayGoals: 0, expected: 'won' },
    { pick: 'Zamalek to win', homeName: 'Al Ahly', awayName: 'Zamalek', homeGoals: 0, awayGoals: 2, expected: 'won' },
    { pick: 'Al Ahly to win', homeName: 'Al Ahly', awayName: 'Zamalek', homeGoals: 1, awayGoals: 1, expected: 'lost' },

    // Double chance: 1X / X2 / 12 / "home or draw".
    { pick: '1X', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'won' },
    { pick: '1X', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 2, expected: 'lost' },
    { pick: 'X2', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 2, expected: 'won' },
    { pick: 'X2', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'lost' },
    { pick: '12', homeName: 'Home', awayName: 'Away', homeGoals: 3, awayGoals: 0, expected: 'won' },
    { pick: '12', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'lost' },
    { pick: 'home or draw', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'won' },
    { pick: 'home or draw', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'won' },
    { pick: 'home or draw', homeName: 'Home', awayName: 'Away', homeGoals: 0, awayGoals: 2, expected: 'lost' },
    { pick: 'away or draw', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 2, expected: 'won' },
    { pick: 'X1', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 2, expected: 'won' },
    { pick: '2X', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 3, expected: 'won' },
    { pick: 'Double Chance 1X', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'won' },
    { pick: 'Double Chance X2', homeName: 'Home', awayName: 'Away', homeGoals: 3, awayGoals: 1, expected: 'lost' },

    // Over / under with .5 or .0 lines; void on a push.
    { pick: 'Over 2.5', homeName: 'Home', awayName: 'Away', homeGoals: 3, awayGoals: 2, expected: 'won' },
    { pick: 'Over 2.5', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 0, expected: 'lost' },
    { pick: 'Over 3.0', homeName: 'Home', awayName: 'Away', homeGoals: 3, awayGoals: 0, expected: 'void' },
    { pick: 'Over 2', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'void' },
    { pick: 'Over 2.0', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'won' },
    { pick: 'Over 0.5', homeName: 'Home', awayName: 'Away', homeGoals: 0, awayGoals: 0, expected: 'lost' },
    { pick: 'Under 2.5', homeName: 'Home', awayName: 'Away', homeGoals: 3, awayGoals: 2, expected: 'lost' },
    { pick: 'Under 2.5', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 0, expected: 'won' },
    { pick: 'Under 2', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'void' },
    { pick: 'Under 3.0', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 2, expected: 'void' },

    // Both teams to score — yes / no.
    { pick: 'Both Teams To Score Yes', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'won' },
    { pick: 'Both Teams To Score No', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 0, expected: 'won' },
    { pick: 'Both Teams To Score - No', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 2, expected: 'lost' },
    { pick: 'Both Teams To Score', homeName: 'Home', awayName: 'Away', homeGoals: 0, awayGoals: 0, expected: 'lost' },
    { pick: 'BTTS', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 2, expected: 'won' },

    // Draw no bet — void on a draw.
    { pick: 'Draw No Bet', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 1, expected: 'void' },
    { pick: 'Draw No Bet', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: 'won' },
    { pick: 'Draw No Bet', homeName: 'Home', awayName: 'Away', homeGoals: 1, awayGoals: 2, expected: 'lost' },

    // Ungradeable markets → null.
    { pick: null, homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: null },
    { pick: '', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: null },
    { pick: 'Over', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: null },
    { pick: 'Correct Score 2-1', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: null },
    { pick: 'Cannot grade this', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 2, expected: null },
    { pick: '1x2', homeName: 'Home', awayName: 'Away', homeGoals: 3, awayGoals: 3, expected: null },
    { pick: 'Over 2.5', homeName: 'Home', awayName: 'Away', homeGoals: null, awayGoals: 1, expected: null },
    { pick: 'Over 2.5', homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: undefined, expected: null },
    { pick: undefined, homeName: 'Home', awayName: 'Away', homeGoals: 2, awayGoals: 1, expected: null },
];

let failures = 0;
CASES.forEach((testCase, index) => {
    const got = evaluatePick(
        testCase.pick,
        testCase.homeName,
        testCase.awayName,
        testCase.homeGoals,
        testCase.awayGoals,
    );
    if (got !== testCase.expected) {
        failures += 1;
        console.log(
            `FAIL #${index + 1}: pick="${String(testCase.pick)}" score=${testCase.homeGoals}-${String(testCase.awayGoals)} ` +
                `expected=${testCase.expected} got=${got}`,
        );
    }
});
console.log(`evaluatePick self-test: ${CASES.length - failures}/${CASES.length} passed`);
process.exit(failures > 0 ? 1 : 0);
