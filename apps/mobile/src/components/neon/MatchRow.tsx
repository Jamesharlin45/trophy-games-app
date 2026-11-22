/**
 * MatchRow — one match inside a NeonCard.
 *
 * Left: kickoff / FT / LIVE / PST. Middle: two 28px crests with full team
 * names (up to two lines). Right: tabular score with the leading team in the
 * accent colour, tier pill and chevron. Locked tiers keep the unlock action.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { ChevronRight, Crown, DollarSign, Lock } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { TeamCrest } from '../TeamCrest';
import { PressScale } from '../PressScale';
import { useTeamColors } from '../../hooks/useTeamColors';
import { readableCopy } from '../../lib/colors';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import type { ApiMatch } from '../../api/client';
import i18n from '../../locales';
import { NeonCard } from './NeonCard';
import { NeonPill, type NeonTone } from './NeonPill';
import { NeonButton } from './NeonButton';
import { readableAccent, withAlpha } from './tokens';

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
    return status === 'Finished' || status === 'FT';
}

function isPostponedStatus(status?: string): boolean {
    return status === 'PST' || status?.toLowerCase().includes('postpon') === true;
}

function timeLabel(match: ApiMatch): string {
    const kickoff = new Date(match.timestamp);
    if (Number.isNaN(kickoff.getTime())) return '—';
    return kickoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface TierBadge {
    text: string;
    Icon?: LucideIcon;
    tone: NeonTone;
    locked: boolean;
}

function getTierBadge(match: ApiMatch, access: { paid: boolean; vip: boolean }): TierBadge {
    if (match.matchType === 'vip') {
        const locked = !access.vip;
        return {
            text: i18n.t('matchCard.vip'),
            Icon: locked ? Lock : Crown,
            tone: locked ? 'warning' : 'accent',
            locked,
        };
    }
    if (match.matchType === 'paid') {
        const locked = !access.paid;
        return {
            text: i18n.t('matchCard.paid'),
            Icon: locked ? Lock : DollarSign,
            tone: locked ? 'warning' : 'info',
            locked,
        };
    }
    return { text: i18n.t('matchCard.free'), tone: 'accent', locked: false };
}

export function MatchRow({ match, access, footer, onOpen }: MatchRowProps) {
    const router = useRouter();
    const { themeColors, isDark } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors, isDark);

    const teamColors = useTeamColors(match.homeTeamLogo, match.awayTeamLogo);
    const badge = getTierBadge(match, access);
    const live = isLiveStatus(match.status);
    const finished = isFinishedStatus(match.status);
    const postponed = isPostponedStatus(match.status);
    const showScore = (live || finished) && match.homeScore !== undefined && match.awayScore !== undefined;

    const statusLabel = live
        ? i18n.t('matchCard.live')
        : finished
            ? i18n.t('matchCard.final')
            : postponed
                ? i18n.t('matchCard.postponed')
                : timeLabel(match);

    const isLocked = badge.locked;
    const lockTier = match.matchType === 'vip' ? 'vip' : 'paid';

    const openDetail = (): void => {
        if (onOpen) {
            onOpen(match);
            return;
        }
        router.push({
            pathname: '/match/[id]',
            params: { id: match.id, matchData: encodeURIComponent(JSON.stringify(match)) },
        });
    };

    return (
        <NeonCard style={styles.card} padded={false}>
            <PressScale
                style={styles.press}
                onPress={openDetail}
                accessibilityRole="link"
                accessibilityLabel={`${match.homeTeam} vs ${match.awayTeam}`}
            >
                <View style={styles.timeCol}>
                    <Text
                        style={[
                            styles.status,
                            { color: live ? accentInk : themeColors.mutedText },
                        ]}
                        numberOfLines={1}
                    >
                        {statusLabel}
                    </Text>
                </View>

                <View style={styles.teamsCol}>
                    <View style={styles.teamLine}>
                        <TeamCrest
                            uri={match.homeTeamLogo}
                            name={match.homeTeam}
                            size={28}
                            teamColor={readableCopy(teamColors.home)}
                            fallbackColors={[themeColors.accent, themeColors.glass]}
                        />
                        <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={2}>
                            {match.homeTeam}
                        </Text>
                    </View>
                    <View style={styles.teamLine}>
                        <TeamCrest
                            uri={match.awayTeamLogo}
                            name={match.awayTeam}
                            size={28}
                            teamColor={readableCopy(teamColors.away)}
                            fallbackColors={[themeColors.accent, themeColors.glass]}
                        />
                        <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={2}>
                            {match.awayTeam}
                        </Text>
                    </View>
                </View>

                <View style={styles.rightCol}>
                    <View style={styles.scoreCol}>
                        <Text
                            style={[
                                styles.score,
                                {
                                    color: showScore && match.homeScore! > match.awayScore!
                                        ? accentInk
                                        : themeColors.text,
                                },
                            ]}
                        >
                            {showScore ? match.homeScore : '–'}
                        </Text>
                        <Text
                            style={[
                                styles.score,
                                {
                                    color: showScore && match.awayScore! > match.homeScore!
                                        ? accentInk
                                        : themeColors.text,
                                },
                            ]}
                        >
                            {showScore ? match.awayScore : '–'}
                        </Text>
                    </View>
                    <View style={styles.tierRow}>
                        <NeonPill
                            label={badge.text}
                            tone={badge.tone}
                            Icon={badge.Icon}
                            iconSize={11}
                        />
                        <ChevronRight size={18} color={themeColors.mutedText} />
                    </View>
                </View>
            </PressScale>

            {isLocked ? (
                <View style={styles.unlockWrap}>
                    <NeonButton
                        variant="outline"
                        radius={12}
                        onPress={() => router.push(lockTier === 'vip' ? '/(tabs)/vip' : '/(tabs)/paid')}
                        accessibilityLabel={lockTier === 'vip' ? i18n.t('matchCard.unlockVip') : i18n.t('matchCard.unlockPremium')}
                    >
                        <Text style={[styles.unlockText, { color: accentInk }]}>
                            {lockTier === 'vip' ? i18n.t('matchCard.unlockVip') : i18n.t('matchCard.unlockPremium')}
                        </Text>
                    </NeonButton>
                </View>
            ) : null}

            {footer}
        </NeonCard>
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
            width: 50,
            alignItems: 'flex-start',
            justifyContent: 'center',
        },
        status: {
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 0.2,
        },
        teamsCol: {
            flex: 1,
            minWidth: 0,
            gap: 10,
        },
        teamLine: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
        },
        teamName: {
            flex: 1,
            minWidth: 0,
            fontSize: 14,
            fontWeight: '700',
            lineHeight: 17,
        },
        rightCol: {
            width: 88,
            alignItems: 'flex-end',
            gap: 8,
        },
        scoreCol: {
            alignItems: 'flex-end',
            gap: 0,
        },
        score: {
            fontSize: 18,
            fontWeight: '800',
            lineHeight: 21,
            fontVariant: ['tabular-nums'],
        },
        tierRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        unlockWrap: {
            paddingHorizontal: 14,
            paddingBottom: 12,
        },
        unlockText: {
            fontSize: 12,
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
