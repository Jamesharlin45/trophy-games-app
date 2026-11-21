/**
 * List card on Home / Premium / VIP / Analysis.
 *
 * Minimal: league label, kickoff time (or LIVE/final score), both crests and
 * team names, a small tier badge and a chevron. Tapping opens the overview.
 * Cards fade in with a short stagger (first 8) and press feedback.
 */

import { Text, Image, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Crown, DollarSign, ChevronRight, Lock } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { TeamCrest } from './TeamCrest';
import { PressScale } from './PressScale';
import { useTeamColors } from '../hooks/useTeamColors';
import { readableCopy } from '../lib/colors';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import type { ApiMatch } from '../api/client';
import i18n from '../locales';

export interface MatchCardProps {
    match: ApiMatch;
    /** Membership access of the current user. */
    access: { paid: boolean; vip: boolean };
    /** Index within the rendered list, used for the entrance stagger. */
    index?: number;
    /** Override navigation target. */
    onOpen?: (match: ApiMatch) => void;
}

function isLiveStatus(status?: string): boolean {
    if (!status) return false;
    return status.includes('Live') || status === 'Halftime' || status === 'HT';
}

function isFinishedStatus(status?: string): boolean {
    return status === 'Finished' || status === 'FT';
}

function timeLabel(match: ApiMatch): string {
    const kickoff = new Date(match.timestamp);
    if (Number.isNaN(kickoff.getTime())) return '—';
    return kickoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface TierBadge {
    text: string;
    icon: 'crown' | 'dollar' | 'lock' | 'none';
    locked: boolean;
}

function getTierBadge(match: ApiMatch, access: { paid: boolean; vip: boolean }): TierBadge {
    const type = match.matchType;
    if (type === 'vip') {
        const locked = !access.vip;
        return { text: i18n.t('matchCard.vip'), icon: locked ? 'lock' : 'crown', locked };
    }
    if (type === 'paid') {
        const locked = !access.paid;
        return { text: i18n.t('matchCard.paid'), icon: locked ? 'lock' : 'dollar', locked };
    }
    return { text: i18n.t('matchCard.free'), icon: 'none', locked: false };
}

export function MatchCard({ match, access, index, onOpen }: MatchCardProps) {
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const teamColors = useTeamColors(match.homeTeamLogo, match.awayTeamLogo);

    const isLocked =
        (match.matchType === 'paid' && !access.paid) || (match.matchType === 'vip' && !access.vip);
    const lockTier = match.matchType === 'vip' ? 'vip' : 'paid';
    const badge = getTierBadge(match, access);

    const live = isLiveStatus(match.status);
    const finished = isFinishedStatus(match.status);
    const showScore = (live || finished) && match.homeScore !== undefined && match.awayScore !== undefined;

    const statusLabel = live
        ? i18n.t('matchCard.live')
        : finished
            ? i18n.t('matchCard.final')
            : timeLabel(match);

    const openDetail = () => {
        const target = onOpen ?? ((m: ApiMatch) => router.push({
            pathname: '/match/[id]',
            params: { id: m.id, matchData: encodeURIComponent(JSON.stringify(m)) },
        }));
        target(match);
    };

    const goToUnlock = () => {
        router.push(lockTier === 'vip' ? '/(tabs)/vip' : '/(tabs)/paid');
    };

    // Staggered entrance: first 8 cards fade + slide in, others appear at once.
    const shouldStagger = index !== undefined && index < 8;
    const entered = useRef(false);
    const fadeIn = useSharedValue(shouldStagger ? 0 : 1);
    useEffect(() => {
        if (shouldStagger && !entered.current) {
            fadeIn.value = withDelay((index as number) * 90, withTiming(1, { duration: 350 }));
        }
        entered.current = true;
    }, [shouldStagger, index, fadeIn]);
    const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeIn.value }));

    const cardStyle: StyleProp<ViewStyle> = [
        styles.card,
        isLocked
            ? { borderColor: `${themeColors.accent}44`, shadowColor: themeColors.accent, shadowRadius: 6, shadowOpacity: 0.35, elevation: 2 }
            : {},
    ];

    return (
        <Animated.View style={[cardStyle, fadeStyle]}>
            <PressScale
                style={styles.mainRow}
                onPress={openDetail}
                accessibilityRole="link"
                accessibilityLabel={`${match.homeTeam} vs ${match.awayTeam}`}
            >
                <View style={styles.leagueRow}>
                    {match.leagueLogo ? (
                        <Image source={{ uri: match.leagueLogo }} style={styles.leagueLogo} />
                    ) : (
                        <View style={[styles.leagueLogo, { backgroundColor: themeColors.glass }]} />
                    )}
                    <Text style={[styles.leagueName, { color: themeColors.mutedText }]} numberOfLines={1}>
                        {match.league}
                    </Text>
                </View>

                <View style={styles.teamsCol}>
                    <View style={styles.teamLine}>
                        <TeamCrest
                            uri={match.homeTeamLogo}
                            name={match.homeTeam}
                            size={30}
                            teamColor={readableCopy(teamColors.home)}
                            fallbackColors={[themeColors.accent, themeColors.glass]}
                        />
                        <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={1}>
                            {match.homeTeam}
                        </Text>
                    </View>
                    <View style={styles.teamLine}>
                        <TeamCrest
                            uri={match.awayTeamLogo}
                            name={match.awayTeam}
                            size={30}
                            teamColor={readableCopy(teamColors.away)}
                            fallbackColors={[themeColors.accent, themeColors.glass]}
                        />
                        <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={1}>
                            {match.awayTeam}
                        </Text>
                    </View>
                </View>

                <View style={styles.timeCol}>
                    <Text style={[styles.statusText, { color: live ? themeColors.accent : themeColors.text }]} numberOfLines={1}>
                        {statusLabel}
                    </Text>
                    {showScore ? (
                        <Text style={[styles.scoreText, { color: themeColors.accent }]}>
                            {match.homeScore} - {match.awayScore}
                        </Text>
                    ) : null}
                </View>

                <View style={styles.rightCol}>
                    <View style={[styles.badge, { borderColor: `${themeColors.accent}33`, backgroundColor: `${themeColors.accent}12` }]}>
                        {badge.icon === 'crown' ? <Crown size={12} color={themeColors.accent} /> : null}
                        {badge.icon === 'dollar' ? <DollarSign size={12} color={themeColors.accent} /> : null}
                        {badge.icon === 'lock' ? <Lock size={12} color={themeColors.accent} /> : null}
                        <Text style={[styles.badgeText, { color: themeColors.accent }]} numberOfLines={1}>
                            {badge.text}
                        </Text>
                    </View>
                    <ChevronRight size={20} color={themeColors.mutedText} />
                </View>
            </PressScale>

            {isLocked ? (
                <PressScale style={styles.unlockRow} onPress={goToUnlock} accessibilityRole="button">
                    <Text style={[styles.unlockText, { color: themeColors.accent }]}>
                        {lockTier === 'vip' ? i18n.t('matchCard.unlockVip') : i18n.t('matchCard.unlockPremium')}
                    </Text>
                </PressScale>
            ) : null}
        </Animated.View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        card: {
            backgroundColor: themeColors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: themeColors.border,
            paddingHorizontal: 12,
            paddingTop: 11,
            paddingBottom: 11,
            marginVertical: 6,
            shadowColor: themeColors.shadow,
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.08,
            shadowRadius: 4,
            elevation: 2,
        },
        mainRow: {
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 66,
            gap: 8,
        },
        leagueRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginRight: 4,
        },
        leagueLogo: {
            width: 15,
            height: 15,
            borderRadius: 3,
        },
        leagueName: {
            fontSize: 11,
            fontWeight: '600',
            letterSpacing: 0.4,
            maxWidth: 90,
        },
        teamsCol: {
            flex: 1,
            justifyContent: 'center',
            gap: 10,
        },
        teamLine: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        teamName: {
            fontSize: 14,
            fontWeight: '700',
            flex: 1,
            letterSpacing: -0.1,
        },
        timeCol: {
            width: 62,
            alignItems: 'flex-end',
            gap: 3,
        },
        statusText: {
            fontSize: 13,
            fontWeight: '700',
        },
        scoreText: {
            fontSize: 15,
            fontWeight: '800',
        },
        rightCol: {
            width: 66,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 6,
        },
        badge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            borderWidth: 1,
            borderRadius: 9,
            paddingHorizontal: 7,
            paddingVertical: 3,
        },
        badgeText: {
            fontSize: 9,
            fontWeight: '700',
            letterSpacing: 0.5,
        },
        unlockRow: {
            marginTop: 4,
            borderRadius: 10,
            borderWidth: 1.5,
            borderColor: `${themeColors.accent}55`,
            paddingVertical: 7,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'stretch',
        },
        unlockText: {
            fontSize: 12,
            fontWeight: '700',
            letterSpacing: 0.5,
        },
    });
}
