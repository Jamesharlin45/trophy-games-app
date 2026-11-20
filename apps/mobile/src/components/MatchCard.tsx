import { View, Text, TouchableOpacity, Image, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { getCountryFlagUrl } from '../lib/flags';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import type { ApiMatch } from '../api/client';
import i18n from '../locales';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface MatchCardProps {
    match: ApiMatch;
    expanded: boolean;
    onToggle: () => void;
    access: { paid: boolean; vip: boolean };
}

const TeamBadge = ({ uri, name }: { uri?: string; name: string }) => {
    const [failed, setFailed] = useState(false);
    const { themeColors } = useTheme();
    const badgeStyles = getBadgeStyles(themeColors);
    const safeName = String(name || '');
    const initials = safeName
        .split(' ')
        .slice(0, 2)
        .map((w: string) => w[0])
        .join('')
        .toUpperCase();
    const flagUri = !uri || failed ? getCountryFlagUrl(name) : undefined;

    if (flagUri) {
        return (
            <View style={badgeStyles.flagBox}>
                <Image source={{ uri: flagUri }} style={badgeStyles.flag} />
            </View>
        );
    }
    if (uri && !failed) {
        return <Image source={{ uri }} style={badgeStyles.logo} onError={() => setFailed(true)} />;
    }
    return (
        <View style={badgeStyles.initialsBox}>
            <Text style={badgeStyles.initials}>{initials}</Text>
        </View>
    );
};

function getBadgeStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        logo: { width: 22, height: 22, borderRadius: 11 },
        flagBox: {
            width: 22,
            height: 22,
            borderRadius: 11,
            overflow: 'hidden',
            backgroundColor: themeColors.glass,
            alignItems: 'center',
            justifyContent: 'center',
        },
        flag: { width: 22, height: 14, resizeMode: 'cover' },
        initialsBox: {
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: themeColors.glass,
            alignItems: 'center',
            justifyContent: 'center',
        },
        initials: {
            fontSize: 10,
            fontWeight: '700',
            textAlign: 'center',
            color: themeColors.mutedText,
        },
    });
}

const isLiveStatus = (status?: string): boolean => {
    if (!status) return false;
    return status.includes('Live') || status === 'Halftime' || status === 'HT';
};

const isFinishedStatus = (status?: string): boolean => {
    return status === 'Finished' || status === 'FT';
};

export const MatchCard = ({ match, expanded, onToggle, access }: MatchCardProps) => {
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const ai = match.aiPrediction;
    const pickText = ai?.pick || ai?.suggestedBet || ai?.prediction;
    const hasPrediction = typeof pickText === 'string' && pickText.trim().length > 0;

    const isLocked =
        (match.matchType === 'paid' && !access.paid) || (match.matchType === 'vip' && !access.vip);
    const lockTier = match.matchType === 'vip' ? 'vip' : 'paid';

    const kickoff = new Date(match.timestamp);
    const timeLabel = Number.isNaN(kickoff.getTime())
        ? '—'
        : kickoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const live = isLiveStatus(match.status);
    const finished = isFinishedStatus(match.status);
    const showScore =
        (live || finished) && match.homeScore !== undefined && match.awayScore !== undefined;

    const oddsLabel = (() => {
        if (match.odds?.home || match.odds?.draw || match.odds?.away) {
            const parts = [match.odds.home, match.odds.draw, match.odds.away].filter(
                (v): v is string => Boolean(v && v !== ''),
            );
            if (parts.length > 0) return parts.join(' / ');
        }
        const h = match.detailedOdds?.ft?.['1x2']?.home;
        const d = match.detailedOdds?.ft?.['1x2']?.draw;
        const a = match.detailedOdds?.ft?.['1x2']?.away;
        const parts = [h, d, a].filter((v): v is string => Boolean(v && v !== ''));
        return parts.length > 0 ? parts.join(' / ') : '—';
    })();

    const reasoningText = Array.isArray(ai?.reasoning) ? ai.reasoning.filter(Boolean).join(' ') : '';
    const confidence = typeof ai?.confidence === 'number' ? Math.max(0, Math.min(100, ai.confidence)) : undefined;
    const risk = ai?.risk;

    const openDetail = () => {
        router.push({
            pathname: '/match/[id]',
            params: {
                id: match.id,
                matchData: encodeURIComponent(JSON.stringify(match)),
            },
        });
    };

    const goToUnlock = () => {
        router.push(lockTier === 'vip' ? '/(tabs)/vip' : '/(tabs)/paid');
    };

    const handleToggle = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        onToggle();
    };

    const pillContent = () => {
        if (isLocked) {
            return (
                <View style={styles.pillInner}>
                    <Lock size={14} color={themeColors.accentText} />
                </View>
            );
        }
        if (!hasPrediction) {
            return <Text style={[styles.pillText, { color: themeColors.accentText }]}>{i18n.t('matchCard.soon')}</Text>;
        }
        return (
            <Text
                style={[styles.pillText, { color: themeColors.accentText }]}
                numberOfLines={1}
            >
                {String(pickText)}
            </Text>
        );
    };

    const riskColor = (() => {
        if (risk === 'low') return themeColors.success;
        if (risk === 'medium') return themeColors.warning;
        if (risk === 'high') return themeColors.danger;
        return themeColors.mutedText;
    })();

    return (
        <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
            <TouchableOpacity
                onPress={handleToggle}
                activeOpacity={0.8}
                accessibilityRole="button"
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

                <View style={styles.mainRow}>
                    <View style={styles.timeCol}>
                        <Text style={[styles.timeText, { color: themeColors.text }]}>{timeLabel}</Text>
                        {showScore ? (
                            <Text style={[styles.scoreText, { color: themeColors.accent }]}>
                                {match.homeScore} - {match.awayScore}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.teamsCol}>
                        <View style={styles.teamLine}>
                            <TeamBadge uri={match.homeTeamLogo} name={match.homeTeam} />
                            <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={1}>
                                {match.homeTeam}
                            </Text>
                        </View>
                        <View style={styles.teamLine}>
                            <TeamBadge uri={match.awayTeamLogo} name={match.awayTeam} />
                            <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={1}>
                                {match.awayTeam}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.pillCol}>
                        <View style={[styles.pill, { backgroundColor: themeColors.accent }]}>{pillContent()}</View>
                    </View>
                </View>
            </TouchableOpacity>

            {expanded ? (
                <View style={[styles.expanded, { borderTopColor: themeColors.border }]}>
                    {isLocked ? (
                        <View style={styles.lockedBox}>
                            <View style={[styles.maskLine, { backgroundColor: themeColors.surfaceElevated }]} />
                            <View style={[styles.maskLine, styles.maskLineShort, { backgroundColor: themeColors.surfaceElevated }]} />
                            <Text style={[styles.lockedText, { color: themeColors.mutedText }]}>
                                {i18n.t('matchCard.lockedPreview')}
                            </Text>
                            <TouchableOpacity
                                style={[styles.unlockBtn, { backgroundColor: themeColors.accent }]}
                                onPress={goToUnlock}
                                activeOpacity={0.85}
                                accessibilityRole="button"
                            >
                                <Text style={[styles.unlockBtnText, { color: themeColors.accentText }]}>
                                    {lockTier === 'vip' ? i18n.t('matchCard.unlockVip') : i18n.t('matchCard.unlockPremium')}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.detailsBox}>
                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeColors.mutedText }]}>{i18n.t('matchCard.pick')}</Text>
                                <Text style={[styles.detailValue, { color: themeColors.text }]} numberOfLines={2}>
                                    {hasPrediction ? String(pickText) : i18n.t('matchCard.soon')}
                                </Text>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeColors.mutedText }]}>{i18n.t('matchCard.confidence')}</Text>
                                <View style={styles.confidenceWrap}>
                                    <View style={[styles.confTrack, { backgroundColor: themeColors.surfaceElevated }]}>
                                        <View
                                            style={[
                                                styles.confFill,
                                                {
                                                    width: `${confidence ?? 0}%`,
                                                    backgroundColor: themeColors.accent,
                                                },
                                            ]}
                                        />
                                    </View>
                                    <Text style={[styles.confPct, { color: themeColors.text }]}>
                                        {confidence !== undefined ? `${confidence}%` : '—'}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.detailRowInline}>
                                <Text style={[styles.detailLabel, { color: themeColors.mutedText }]}>{i18n.t('matchCard.risk')}</Text>
                                <View
                                    style={[
                                        styles.riskBadge,
                                        { backgroundColor: `${riskColor}22`, borderColor: `${riskColor}55` },
                                    ]}
                                >
                                    <Text style={[styles.riskText, { color: riskColor }]}>
                                        {risk ? i18n.t(`risk.${risk}`) : '—'}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.detailRow}>
                                <Text style={[styles.detailLabel, { color: themeColors.mutedText }]}>{i18n.t('matchCard.odds')}</Text>
                                <Text style={[styles.detailValue, { color: themeColors.text }]}>{oddsLabel}</Text>
                            </View>

                            {reasoningText ? (
                                <View style={styles.detailRow}>
                                    <Text style={[styles.reasoningText, { color: themeColors.mutedText }]} numberOfLines={2}>
                                        {reasoningText}
                                    </Text>
                                </View>
                            ) : null}

                            <TouchableOpacity
                                onPress={openDetail}
                                activeOpacity={0.7}
                                style={styles.moreBtn}
                                accessibilityRole="link"
                            >
                                <Text style={[styles.moreText, { color: themeColors.accent }]}>{i18n.t('matchCard.more')}</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            ) : null}
        </View>
    );
};

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        card: {
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: 10,
            marginVertical: 6,
            borderWidth: 1,
            shadowColor: themeColors.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.12,
            shadowRadius: 8,
            elevation: 2,
        },
        leagueRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginBottom: 6,
        },
        leagueLogo: {
            width: 14,
            height: 14,
            borderRadius: 3,
        },
        leagueName: {
            fontSize: 14,
            fontWeight: '500',
            flex: 1,
        },
        mainRow: {
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 72,
            gap: 10,
        },
        timeCol: {
            width: 58,
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: 4,
        },
        timeText: {
            fontSize: 14,
            fontWeight: '700',
        },
        scoreText: {
            fontSize: 14,
            fontWeight: '700',
        },
        teamsCol: {
            flex: 1,
            justifyContent: 'center',
            gap: 8,
        },
        teamLine: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
        },
        teamName: {
            fontSize: 14,
            fontWeight: '600',
            flex: 1,
        },
        pillCol: {
            width: 96,
            alignItems: 'flex-end',
            justifyContent: 'center',
        },
        pill: {
            minHeight: 44,
            minWidth: 72,
            maxWidth: 96,
            paddingHorizontal: 10,
            paddingVertical: 10,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        pillInner: {
            alignItems: 'center',
            justifyContent: 'center',
        },
        pillText: {
            fontSize: 14,
            fontWeight: '700',
            textAlign: 'center',
        },
        expanded: {
            marginTop: 10,
            paddingTop: 10,
            borderTopWidth: StyleSheet.hairlineWidth,
        },
        detailsBox: {
            gap: 10,
        },
        detailRow: {
            gap: 4,
        },
        detailRowInline: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
        },
        detailLabel: {
            fontSize: 14,
            fontWeight: '600',
        },
        detailValue: {
            fontSize: 14,
            fontWeight: '500',
            lineHeight: 20,
        },
        confidenceWrap: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
        },
        confTrack: {
            flex: 1,
            height: 8,
            borderRadius: 4,
            overflow: 'hidden',
        },
        confFill: {
            height: 8,
            borderRadius: 4,
        },
        confPct: {
            fontSize: 14,
            fontWeight: '700',
            minWidth: 44,
            textAlign: 'right',
        },
        riskBadge: {
            minHeight: 32,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 10,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
        },
        riskText: {
            fontSize: 14,
            fontWeight: '700',
        },
        reasoningText: {
            fontSize: 14,
            lineHeight: 20,
        },
        moreBtn: {
            minHeight: 44,
            justifyContent: 'center',
            alignSelf: 'flex-start',
            paddingRight: 12,
        },
        moreText: {
            fontSize: 14,
            fontWeight: '700',
        },
        lockedBox: {
            gap: 10,
        },
        maskLine: {
            height: 14,
            borderRadius: 6,
            width: '100%',
        },
        maskLineShort: {
            width: '70%',
        },
        lockedText: {
            fontSize: 14,
            fontWeight: '500',
        },
        unlockBtn: {
            minHeight: 44,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
            marginTop: 2,
        },
        unlockBtnText: {
            fontSize: 14,
            fontWeight: '700',
            textAlign: 'center',
        },
    });
}
