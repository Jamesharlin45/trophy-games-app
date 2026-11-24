/**
 * Pure evaluation of an AI "pick" against a finished match score.
 *
 * Returns 'won' | 'lost' | 'void' | null.
 * - 'won' / 'lost': the pick is graded against the final score.
 * - 'void': the pick settles on a technicality — a draw no-bet or an
 *   over/under push.
 * - null: the market cannot be graded from the final score (e.g. correct
 *   score); the row is left for the admin.
 */
export type PickEvaluation = 'won' | 'lost' | 'void' | null;

function normalizeText(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function evaluatePick(
    pickText: string | null | undefined,
    homeName: string,
    awayName: string,
    homeGoals: number | null | undefined,
    awayGoals: number | null | undefined,
): PickEvaluation {
    if (typeof homeGoals !== 'number' || typeof awayGoals !== 'number') return null;
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) return null;

    const homeWins = homeGoals > awayGoals;
    const awayWins = awayGoals > homeGoals;
    const isDraw = !homeWins && !awayWins;
    const total = homeGoals + awayGoals;

    const p = (pickText ?? '')
        .toLowerCase()
        .replace(/[:_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!p) return null;
    const pc = p.replace(/\s+/g, '');

    // --- Over / Under (any .5 or .0 line; a push on the line voids).
    const overUnder = p.match(/^(over|under|ov|un)\s*(\d+(?:\.\d+)?)/);
    if (overUnder) {
        const line = parseFloat(overUnder[2]);
        if (!Number.isFinite(line)) return null;
        const isOver = overUnder[1].startsWith('ov') || overUnder[1] === 'over';
        if (isOver) {
            return total > line ? 'won' : total === line ? 'void' : 'lost';
        }
        return total < line ? 'won' : total === line ? 'void' : 'lost';
    }

    // --- Both teams to score (yes / no).
    const scored = homeGoals > 0 && awayGoals > 0;
    if (
        p.includes('both teams to score') ||
        p.includes('both teams score') ||
        pc.startsWith('btts')
    ) {
        const wantNo = /\bno\b/.test(p);
        const wantYes = !wantNo;
        return scored === wantYes ? 'won' : 'lost';
    }

    // --- Draw no bet (void on a draw, home/away otherwise).
    if (pc === 'drawnobet' || pc.startsWith('dnb')) {
        return isDraw ? 'void' : homeWins ? 'won' : 'lost';
    }

    // --- Double chance (compact or textual): 1X / X2 / 12 / "home or draw" /
    //     "away or draw" / "home or away", including "Double Chance 1X" style
    //     phrasing.
    if (pc === '1x' || pc === 'x1' || p.includes('home or draw') || p.includes('draw or home')) {
        return homeWins || isDraw ? 'won' : 'lost';
    }
    if (pc === 'x2' || pc === '2x' || p.includes('away or draw') || p.includes('draw or away')) {
        return awayWins || isDraw ? 'won' : 'lost';
    }
    if (pc === '12' || p.includes('home or away') || p.includes('away or home')) {
        return homeWins || awayWins ? 'won' : 'lost';
    }
    if (p.includes('double chance')) {
        const rest = p.replace(/double chance/g, '').trim();
        const rpc = rest.replace(/\s+/g, '');
        if (rpc === '1x' || rpc === 'x1') return homeWins || isDraw ? 'won' : 'lost';
        if (rpc === 'x2' || rpc === '2x') return awayWins || isDraw ? 'won' : 'lost';
        if (rpc === '12') return homeWins || awayWins ? 'won' : 'lost';
    }

    // --- Classic 1X2 notation: "1" (home win), "2" (away win), "X" (draw),
    //     plus the "home win" / "away win" phrasings.
    if (pc === 'homewin') return homeWins ? 'won' : 'lost';
    if (pc === 'awaywin') return awayWins ? 'won' : 'lost';
    if (pc === '1') return homeWins ? 'won' : 'lost';
    if (pc === '2') return awayWins ? 'won' : 'lost';
    if (pc === 'x') return isDraw ? 'won' : 'lost';

    // --- Home / Away / Draw by name.
    if (pc === 'home') return homeWins ? 'won' : 'lost';
    if (pc === 'away') return awayWins ? 'won' : 'lost';
    if (pc === 'draw') return isDraw ? 'won' : 'lost';

    // --- "<TeamName> to win" (also plain "<TeamName>").
    const homeNorm = normalizeText(homeName);
    const awayNorm = normalizeText(awayName);
    const teamPart = p.replace(/\bto win\b/g, '').trim();
    if (teamPart === homeNorm) return homeWins ? 'won' : 'lost';
    if (teamPart === awayNorm) return awayWins ? 'won' : 'lost';
    if (teamPart === 'draw') return isDraw ? 'won' : 'lost';
    if (teamPart === 'home') return homeWins ? 'won' : 'lost';
    if (teamPart === 'away') return awayWins ? 'won' : 'lost';

    return null;
}
