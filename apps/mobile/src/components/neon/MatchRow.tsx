/**
 * MatchRow — one match inside a Card.
 *
 * Reference layout (layout inspiration only):
 *  - Left: time column — time bold + date small.
 *  - League as a small secondary label above the two team lines.
 *  - Two team lines: crest (24px) + bold full team name.
 *  - Small odds line (1 3.15  X 3.82  2 2.22) when odds exist.
 *  - Right: locked rows show a lock icon plus one small line, never a big button.
 *  - Finished matches: large score with FT + result badge.
 *
 * History rule: finished matches show the pick/reasoning/sources
 * for every tier (no "Unlock" text on finished matches).
 */

import { StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { ChevronRight, Lock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { TeamCrest } from '../TeamCrest';
import { PressScale } from '../PressScale';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import type { ApiMatch } from '../../api/client';
import i18n from '../../locales';
import { Card } from '../design/Card';
import { Pill } from '../design/Pill';
import { Badge } from '../design/Badge';
import { withAlpha } from './tokens';

export interface MatchRowProps {
    match: ApiMatch;
    access: { paid: boolean; vip: boolean };
    /** Optional extra content under the row (result badge + pick line). */
    footer?: ReactNode;
    onOpen?: (match: ApiMatch) => void;
}

function isLiveStatus(status?: string): boolean {
    if (!status) return false;
    return status.includes('Live') || status === 'Halftime' || status === 'HT';
}

function isFinishedStatus(status?: string): boolean {
    return status === 'Finished' || status === 'FT' || status === 'AET' || status === 'PEN';
}

function isFinished(match: ApiMatch): boolean {
    const result = match.result;
    return Boolean(result && result !== 'pending') || isFinishedStatus(match.status);
}

function isPostponedStatus(status?: string): boolean {
    return status === 'PST' || status?.toLowerCase().includes('postpon') === true;
}

/** Time bold in the left column + the date small beneath it. */
function timeLabel(match: ApiMatch): { time: string; date: string } {
    const kickoff = new Date(match.timestamp);
    if (Number.isNaN(kickoff.getTime())) return { time: '—', date: '' };
    return {
        time: kickoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: kickoff.toLocaleDateString([], { month: 'short', day: '2-digit' }),
    };
}

/** Odds pairs for the small odds line, from the pre-match odds. */
function oddsLine(match: ApiMatch): { label: string; value: string }[] {
    const odds = match.odds;
    const pairs: { label: string; value: string }[] = [];
    if (!odds) return pairs;
    if (odds.home) pairs.push({ label: '1', value: String(odds.home) });
    if (odds.draw) pairs.push({ label: 'X', value: String(odds.draw) });
    if (odds.away) pairs.push({ label: '2', value: String(odds.away) });
    return pairs;
}

interface TierBadge {
    label: string;
    tone: 'accent' | 'neutral';
    locked: boolean;
}

function getTierBadge(match: ApiMatch, access: { paid: boolean; vip: boolean }): TierBadge {
    if (match.matchType === 'vip') {
        const locked = !access.vip;
        return { label: i18n.t('matchCard.vip'), tone: locked ? 'neutral' : 'accent', locked };
    }
    if (match.matchType === 'paid') {
        const locked = !access.paid;
        return { label: i18n.t('matchCard.paid'), tone: locked ? 'neutral' : 'accent', locked };
    }
    return { label: i18n.t('matchCard.free'), tone: 'accent', locked: false };
}

export function MatchRow({ match, access, footer, onOpen }: MatchRowProps) {
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const openDetail = () => {
        if (onOpen) {
            onOpen(match);
            return;
        }
        router.push({
            pathname: '/match/[id]',
            params: { id: match.id, matchData: encodeURIComponent(JSON.stringify(match)) },
        });
    };

    const live = isLiveStatus(match.status);
    const finished = isFinished(match);
    const postponed = isPostponedStatus(match.status);
    const showScore =
        (live || finished) && match.homeScore !== undefined && match.awayScore !== undefined;

    // Tier badge rules for UPCOMING matches. FINISHED matches never lock.
    const tierBadge = getTierBadge(match, access);
    const locked = !finished && tierBadge.locked;
    const lockTier = match.matchType === 'vip' ? 'vip' : 'paid';

    const showLock = locked;

    const statusText = live
        ? i18n.t('matchCard.live')
        : finished
            ? i18n.t('matchCard.final')
            : postponed
                ? i18n.t('matchCard.postponed')
                : timeLabel(match).time;

    const odds = oddsLine(match);
    const result = match.result;

    return (
        <Card style={styles.card} padded={false}>
            <PressScale
                style={styles.press}
                onPress={openDetail}
                accessibilityRole="link"
                accessibilityLabel={`${match.homeTeam} vs ${match.awayTeam}`}
            >
                <View style={styles.timeCol}>
                    <Text style={[styles.status, { color: live ? themeColors.onSurface : themeColors.text }]}>
                        {statusText}
                    </Text>
                    {timeLabel(match).date ? (
                        <Text style={[styles.date, { color: themeColors.textSecondary }]}>
                            {timeLabel(match).date}
                        </Text>
                    ) : null}
                </View>

                <View style={styles.body}>
                    {match.league ? (
                        <Text style={[styles.leagueLabel, { color: themeColors.textSecondary }]} numberOfLines={1}>
                            {match.league}
                        </Text>
                    ) : null}

                    <View style={styles.teamLine}>
                        <TeamCrest uri={match.homeTeamLogo} name={match.homeTeam} size={24} />
                        <Text style={[styles.teamName, { color: themeColors.onSurface }]} numberOfLines={2}>
                            {match.homeTeam}
                        </Text>
                    </View>
                    <View style={styles.teamLine}>
                        <TeamCrest uri={match.awayTeamLogo} name={match.awayTeam} size={24} />
                        <Text style={[styles.teamName, { color: themeColors.onSurface }]} numberOfLines={2}>
                            {match.awayTeam}
                        </Text>
                    </View>

                    {odds.length > 0 ? (
                        <View style={styles.oddsLine}>
                            {odds.map((o, i) => (
                                <Text key={i} style={[styles.odds, { color: themeColors.textSecondary }]}>
                                    {o.label} {o.value}
                                </Text>
                            ))}
                        </View>
                    ) : null}
                </View>

                <View style={styles.rightCol}>
                    {showScore ? (
                        <View style={styles.scoreCol}>
                            <Text style={[styles.score, { color: themeColors.onSurface }]}>{match.homeScore}</Text>
                            <Text style={[styles.score, { color: themeColors.onSurface }]}>{match.awayScore}</Text>
                            {result && result !== 'pending' ? (
                                <Badge
                                    kind={result === 'win' ? 'win' : result === 'lose' ? 'lose' : 'void'}
                                    label={
                                        result === 'win' ? i18n.t('wins.resultWin')
                                            : result === 'lose' ? i18n.t('wins.resultLoss')
                                                : i18n.t('wins.resultVoid')
                                    }
                                />
                            ) : null}
                        </View>
                    ) : locked ? null : (
                        tierBadge && <Pill label={tierBadge.label} tone={tierBadge.tone} iconSize={11} />
                    )}

                    {showLock ? (
                        <View style={styles.lockRow}>
                            <Lock size={13} color={themeColors.textSecondary} />
                            <Text style={[styles.lockLine, { color: themeColors.textSecondary }]}>
                                {`${lockTier === 'vip' ? i18n.t('matchCard.vip') : i18n.t('matchCard.paid')} prediction`}
                            </Text>
                        </View>
                    ) : null}
                </View>

                <ChevronRight size={16} color={themeColors.textSecondary} />
            </PressScale>

            {footer}
        </Card>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        card: {
            marginVertical: 5,
            overflow: 'hidden',
        },
        press: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 88,
            paddingHorizontal: 14,
            paddingVertical: 12,
        },
        timeCol: {
            width: 46,
            alignItems: 'flex-start',
            gap: 2,
        },
        status: {
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 0.2,
        },
        date: {
            fontSize: 10,
            fontWeight: '500',
        },
        body: {
            flex: 1,
            minWidth: 0,
            gap: 6,
        },
        leagueLabel: {
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.3,
        },
        teamLine: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
        },
        teamName: {
            flex: 1,
            minWidth: 0,
            fontSize: 15,
            fontWeight: '700',
            lineHeight: 19,
        },
        oddsLine: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 6,
        },
        odds: {
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.2,
        },
        rightCol: {
            alignItems: 'flex-end',
            gap: 6,
            minWidth: 60,
        },
        scoreCol: {
            alignItems: 'flex-end',
            gap: 2,
        },
        score: {
            fontSize: 16,
            fontWeight: '800',
            lineHeight: 19,
            fontVariant: ['tabular-nums'],
        },
        lockRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        lockLine: {
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.3,
        },
        // Exposed for grouped lists that need a hairline above the footer.
        footerDivider: {
            height: 1,
            backgroundColor: withAlpha(themeColors.accent, 0.25),
            marginHorizontal: 14,
        },
    });
}
