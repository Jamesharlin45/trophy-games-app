/**
 * Match overview page — design system version (reference B).
 *
 * Header: round back button left, round accent-filled action right, centred
 * secondary competition name; the two teams (crest 64px + bold name under)
 * around a large bold kickoff time with the date under it (finished matches:
 * a large score with FT).
 *
 * History rule: FINISHED matches (status FT/AET/PEN or a result of win,
 * lose, draw or void) show pick, reasoning and sources for ALL
 * tiers — never "Unlock with VIP" or "Prediction locked".
 *
 * Tabs: Overview, Prediction (lock icon when locked), and Form/H2H or Stats
 * only if data exists. Prediction tab: pick, suggested bet, reasons as check
 * rows, sources as small tappable domain chips. When locked: placeholder
 * bars plus one unlock card linking to the Store.
 */

import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { QUERY_TIMEOUT_MS } from '../../hooks/useLiveQuery';
import { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import type { AppTabDef, IonName } from '../../components/design/AppTabs';
import * as ShareAPI from 'expo-sharing';
import * as Linking from 'expo-linking';
import { api } from '../../api/client';
import type { ApiMatch } from '../../api/client';
import { fetchMatchStats } from '../../api/footystats';
import type { MatchDetailData } from '../../api/footystats';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { useMembershipAccess } from '../../hooks/useMembershipAccess';
import { TeamCrest } from '../../components/TeamCrest';
import { OverviewTabs } from '../../components/OverviewTabs';
import { SkeletonList } from '../../components/Skeleton';
import { Card } from '../../components/design/Card';
import { AppButton } from '../../components/design/AppButton';
import { Pill } from '../../components/design/Pill';
import { ProgressBar } from '../../components/design/ProgressBar';
import { onColor, readableAccent } from '../../components/neon/tokens';
import i18n from '../../locales';
import { setStringAsync as setClipboardString } from 'expo-clipboard';
import { AppErrorBoundary } from '../../components/AppErrorBoundary';

/**
 * Match screen — wrapped in an ErrorBoundary so a render crash shows the
 * friendly fallback (Back / Retry / Copy error details) instead of closing
 * the app. The page-level error handling (loading / error / not-found
 * states) lives inside MatchDetailScreenInner.
 */
export default function MatchScreen() {
    return (
        <AppErrorBoundary>
            <MatchDetailScreenInner />
        </AppErrorBoundary>
    );
}
import {
    domainOf,
    formatDate,
    formatTime,
    isFinishedMatch,
    isLiveMatch,
    marketTotal as marketOddsTotal,
    clampPercent,
    normalizeDetailedOdds,
    normalizeH2h,
    normalizeLineups,
    normalizePotentials,
    normalizeStats,
    parseOdds,
    pickTextFrom,
    reasoningLines as reasoningLinesOf,
    formString,
    impliedProbabilities,
    normalizedOdds,
    sourceUrls,
    parseTimestamp,
    scoreText,
    shareUrlFor,
    toFiniteNumber,
    xgOf,
} from '../../utils/matchData';
import type { NormalizedAiPrediction, NormalizedOdds13 } from '../../utils/matchData';

type MatchViewModel = Omit<
    ApiMatch,
    'h2h' | 'detailedOdds' | 'homeLineup' | 'awayLineup' | 'goals' | 'stats' | 'potentials' | 'oddsComparison' | 'aiPrediction'
> &
    Partial<MatchDetailData> & {
        aiPrediction?: NormalizedAiPrediction | null;
        // Raw web payload key; the camelCase field is the mapped shape.
        ai_prediction?: { sources?: string[] };
    };

type Odds13 = NormalizedOdds13;

/** A hanging by-id request must become an error/Retry, never a permanent skeleton. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`Request timed out: ${label}`)), ms);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function MatchDetailScreenInner() {
    const { id, matchData } = useLocalSearchParams();
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);
    const access = useMembershipAccess();

    const [match, setMatch] = useState<MatchViewModel | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('overview');
    const [error, setError] = useState<{ message: string; stack?: string } | null>(null);

    const reloadMatch = useCallback(async () => {
        let cancelled = false;


        const loadMatch = async () => {
            setLoading(true);
            setError(null);

            // 1. Start with instant placeholder from navigation params.
            let base: MatchViewModel | null = null;
            if (matchData) {
                try {
                    const parsed: unknown = JSON.parse(decodeURIComponent(matchData as string));
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        base = parsed as MatchViewModel;
                        if (!cancelled) setMatch(base);
                    }
                } catch (parseError) {
                    console.warn('[Match Detail] Failed to parse matchData param:', parseError);
                }
            }

            // 2. The API record gives the overlay (matchType, scores, status).
            let merged: MatchViewModel | null = base;
            try {
                const remoteMatch = await withTimeout(
                    api.matches.byId(id as string),
                    QUERY_TIMEOUT_MS,
                    '/api/app/matches/by-id',
                );
                if (remoteMatch) {
                    const patch = Object.fromEntries(
                        Object.entries(remoteMatch).filter(([, v]) => v !== undefined && v !== ''),
                    ) as Partial<MatchViewModel>;
                    const next: MatchViewModel = {
                        ...(base ?? {}),
                        ...patch,
                        league: remoteMatch.league || base?.league || '',
                        country: remoteMatch.country || base?.country,
                    } as MatchViewModel;
                    merged = next;
                    if (!cancelled) setMatch(next);
                }
            } catch (apiError) {
                // Error state with a Retry button — never a crash, never a false "done".
                if (!cancelled) {
                    setError({
                        message: apiError instanceof Error ? apiError.message : String(apiError),
                        stack: apiError instanceof Error ? apiError.stack : undefined,
                    });
                }
            }

            // 3. Fetch the rich match-stats from the API (same source as web).
            try {
                const stats = await fetchMatchStats(id as string);
                if (stats && !cancelled) {
                    const richPatch = Object.fromEntries(
                        Object.entries(stats).filter(([, v]) =>
                            v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
                        ),
                    ) as Partial<MatchViewModel>;
                    setMatch({
                        ...(merged ?? {}),
                        ...richPatch,
                        league: merged?.league || stats.league,
                        country: merged?.country || stats.country,
                        matchType: merged?.matchType,
                    } as MatchViewModel);
                }
            } catch (statsError) {
                // Rich stats are optional — the page renders with what we have.
                console.warn('[Match Detail] match-stats fetch failed:', statsError);
            }

            if (!cancelled) setLoading(false);
        };

        void loadMatch();
        return () => { cancelled = true; };
    }, [id, matchData]);

    useFocusEffect(useCallback(() => void reloadMatch(), [reloadMatch]));

    // ---- Derived state (hooks first, so ordering stays stable) ----
    const isLive = match ? isLiveMatch(match.status) : false;
    const isFinished = isFinishedMatch(match);
    const odds1x2: Odds13 = normalizedOdds(match?.detailedOdds?.ft?.['1x2']);
    const hasDetailedOdds = Boolean(odds1x2.home || odds1x2.draw || odds1x2.away);
    const kickoff = parseTimestamp(match?.timestamp);
    const kickMs = match ? kickoff.getTime() : 0;

    const sources = useMemo(() => sourceUrls(match?.aiPrediction ?? match?.ai_prediction), [match?.aiPrediction, match?.ai_prediction]);
    const sourceList = useMemo(
        () => sources.map((s) => ({ key: s, domain: domainOf(s), url: s })),
        [sources],
    );

    const homeForm = formString(match?.homeForm);
    const awayForm = formString(match?.awayForm);

    const tabs = useMemo<AppTabDef[]>(
        () => [
            { id: 'overview', label: textFor('matchDetail.tabOverview', 'Overview'), name: 'eye-outline' as const },
            ...(homeForm || awayForm
                ? [{ id: 'form', label: textFor('matchDetail.tabForm', 'Form'), name: 'people-outline' as const }]
                : []),
            ...(hasDetailedOdds
                ? [{ id: 'odds', label: textFor('matchDetail.tabOdds', 'Odds'), name: 'stats-chart-outline' as const }]
                : []),
            ...((match?.stats && match.stats.length > 0)
                ? [{ id: 'stats', label: textFor('matchDetail.tabStats', 'Stats'), name: 'stats-chart-outline' as const }]
                : []),
            ...((match?.h2h?.history && match.h2h.history.length > 0)
                ? [{ id: 'h2h', label: textFor('matchDetail.tabH2H', 'H2H'), name: 'people-outline' as const }]
                : []),
        ],
        [hasDetailedOdds, match?.stats, match?.h2h?.history, homeForm, awayForm],
    );
    const activeTab = tabs.find((t) => t.id === tab) ? tab : 'overview';

    if (error) {
        return (
            <MatchPageErrorScreen
                error={error}
                onBack={() => router.back()}
                onRetry={() => void reloadMatch()}
            />
        );
    }

    if (loading && !match) {
        return (
            <SafeAreaView style={[styles.container, { paddingTop: 12 }]} edges={['left', 'right']}>
                <SkeletonList style={{ paddingHorizontal: 16, width: '100%' }} />
            </SafeAreaView>
        );
    }

    if (!match) {
        return (
            <SafeAreaView style={styles.container} edges={['left', 'right']}>
                <View style={styles.unavailableWrap}>
                    <Text style={[styles.unavailableText, { color: themeColors.textSecondary }]}>
                        {textFor('matchDetail.unavailable', 'Match details unavailable')}
                    </Text>
                    <AppButton onPress={() => router.back()} style={styles.backCta}>
                        {textFor('matchDetail.goBack', 'Go back')}
                    </AppButton>
                </View>
            </SafeAreaView>
        );
    }

    const ai = match.aiPrediction ?? null;
    const pickText = pickTextFrom(ai);
    const hasPrediction = pickText !== undefined;
    const reasoningList = reasoningLinesOf(ai);

    const scoreDisplay = scoreText(match.homeScore, match.awayScore);
    const showScore = (isLive || isFinished) && match.homeScore !== undefined && match.awayScore !== undefined;

    const shareUrl = shareUrlFor(match.id);
    const handleShare = async () => {
        try {
            const available = await ShareAPI.isAvailableAsync();
            if (available) {
                await ShareAPI.shareAsync(shareUrl);
            } else {
                await Linking.openURL(shareUrl);
            }
        } catch {
            // Sharing is a convenience — never block the screen.
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['left', 'right', 'top']}>
            <View style={styles.headerWrap}>
                <Card style={styles.headerCard} padded={false} radius={20}>
                    <View style={styles.headerTop}>
                        <TouchableOpacity
                            onPress={() => router.back()}
                            style={styles.roundBtn}
                            accessibilityRole="button"
                            accessibilityLabel={textFor('matchDetail.goBack', 'Go back')}
                        >
                            <Ionicons name="arrow-back-outline" size={22} color={themeColors.onSurface} />
                        </TouchableOpacity>
                        <View style={styles.headerMeta}>
                            <Text style={[styles.competition, { color: themeColors.textSecondary }]} numberOfLines={1}>
                                {match.league || textFor('matchDetail.matchDetails', 'Match Details')}
                            </Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => void handleShare()}
                            style={styles.roundBtnOut}
                            accessibilityRole="button"
                            accessibilityLabel={textFor('matchDetail.share', 'Share')}
                        >
                            <Ionicons name="share-outline" size={20} color={accentInk} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.teamBlocksRow}>
                        <View style={styles.teamBlock}>
                            <TeamCrest
                                uri={match.homeTeamLogo}
                                name={match.homeTeam}
                                size={64}
                            />
                            <Text style={[styles.teamNameBig, { color: themeColors.onSurface }]} numberOfLines={2}>
                                {match.homeTeam}
                            </Text>
                        </View>

                        <View style={styles.timeWrap}>
                            {showScore ? (
                                <>
                                    <Text style={[styles.scoreBig, { color: themeColors.onSurface }]}>{scoreDisplay}</Text>
                                    <Text style={[styles.ftText, { color: accentInk }]}>
                                        {textFor('matchDetail.statusFinished', 'FT')}
                                    </Text>
                                </>
                            ) : (
                                <>
                                    <Text style={[styles.timeBig, { color: accentInk }]}>
                                        {kickMs > 0 ? formatTime(kickoff) : textFor('matchDetail.upcoming', 'Upcoming')}
                                    </Text>
                                    {kickMs > 0 ? (
                                        <Text style={[styles.timeDate, { color: themeColors.textSecondary }]}>
                                            {formatDate(kickoff)}
                                        </Text>
                                    ) : null}
                                </>
                            )}
                        </View>

                        <View style={styles.teamBlock}>
                            <TeamCrest
                                uri={match.awayTeamLogo}
                                name={match.awayTeam}
                                size={64}
                            />
                            <Text style={[styles.teamNameBig, { color: themeColors.onSurface }]} numberOfLines={2}>
                                {match.awayTeam}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.statusRow}>
                        <Pill
                            label={
                                isFinished
                                    ? textFor('matchDetail.statusFinished', 'FT')
                                    : isLive
                                        ? textFor('matchDetail.statusLive', 'LIVE')
                                        : `${textFor('matchDetail.upcoming', 'Upcoming')} · ${kickMs > 0 ? formatTime(kickoff) : ''}`.trim()
                            }
                            tone={isLive ? 'success' : isFinished ? 'neutral' : 'accent'}
                            dot
                        />
                    </View>
                </Card>
            </View>

            <OverviewTabs tabs={tabs} active={activeTab} onChange={setTab} />

            <ScrollView
                style={styles.content}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                key={activeTab}
            >
                {activeTab === 'overview' ? (
                    <OverviewContent
                        match={match}
                        isFinished={isFinished}
                        accessLoading={access.loading}
                        hasPrediction={hasPrediction}
                        pickText={pickText}
                        reasoningLines={reasoningList}
                        sourceList={sourceList}
                        lockTier={match.matchType === 'vip' ? 'vip' : 'paid'}
                        isLocked={!isFinished && ((match.matchType === 'paid' && !access.paid) || (match.matchType === 'vip' && !access.vip))}
                        onUnlock={() => router.push('/(tabs)/market')}
                    />
                ) : activeTab === 'form' ? (
                    <FormContent match={match} />
                ) : activeTab === 'h2h' ? (
                    <H2HContent match={match} />
                ) : activeTab === 'stats' ? (
                    <StatsContent match={match} />
                ) : (
                    <OddsContent match={match} />
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Overview tab (reference B: pick, suggested bet, reasons as check rows,
// sources as tappable chips)
// ---------------------------------------------------------------------------

function OverviewContent({
    match,
    isFinished,
    accessLoading,
    hasPrediction,
    pickText,
    reasoningLines,
    sourceList,
    lockTier,
    isLocked,
    onUnlock,
}: {
    match: MatchViewModel;
    isFinished: boolean;
    accessLoading: boolean;
    hasPrediction: boolean;
    pickText: string | undefined;
    reasoningLines: string[];
    sourceList: { key: string; domain: string; url: string }[];
    lockTier: string;
    isLocked: boolean;
    onUnlock: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);

    if (accessLoading) {
        return <SkeletonList style={{ paddingHorizontal: 16, width: '100%' }} />;
    }

    if (isLocked) {
        return <LockedPickCard lockTier={lockTier} onUnlock={onUnlock} />;
    }

    if (!hasPrediction && !isFinished) {
        return (
            <View style={styles.emptyState}>
                <Ionicons name="medal-outline" size={24} color={accentInk} />
                <Text style={[styles.emptyTitle, { color: themeColors.onSurface }]}>{textFor('matchDetail.noPredictionTitle', 'No prediction yet')}</Text>
                <Text style={[styles.emptyBody, { color: themeColors.textSecondary }]}>{textFor('matchDetail.noPredictionBody', 'Check back later for AI analysis.')}</Text>
            </View>
        );
    }

    const dOdds: Odds13 = normalizedOdds(match.detailedOdds?.ft?.['1x2']);
    const oddValues: { label: string; value?: string }[] = [];
    if (dOdds.home) oddValues.push({ label: textFor('matchDetail.home', 'HOME'), value: dOdds.home });
    if (dOdds.draw) oddValues.push({ label: textFor('matchDetail.draw', 'DRAW'), value: dOdds.draw });
    if (dOdds.away) oddValues.push({ label: textFor('matchDetail.away', 'AWAY'), value: dOdds.away });

    const impliedProbs = impliedProbabilities(dOdds);
    const oddsTotal = marketOddsTotal(dOdds);
    const firstOdds = oddValues[0] ? parseOdds(oddValues[0].value) : null;
    // Implied probabilities show only when every odds value is valid and > 1.
    const marketPct = oddsTotal > 0 && firstOdds !== null && oddValues[0]
        ? clampPercent((firstOdds / oddsTotal) * 100)
        : null;
    const labelValues = impliedProbs ? impliedProbs.map((pct) => `${Math.round(pct)}%`) : oddValues.map((v) => v.value);

    return (
        <View style={styles.overviewContent}>
            <PickCard
                pickText={pickText}
                suggestedBet={match.aiPrediction?.suggestedBet}
                oddValues={oddValues}
            />

            {marketPct !== null && (
                <Card style={styles.card} accessibilityLabel={textFor('matchDetail.marketView', 'Market view (from odds)')}>
                    <SectionTitle name="stats-chart-outline" title={textFor('matchDetail.marketView', 'Market view (from odds)')} />
                    <ProgressBar
                        value={marketPct}
                        height={10}
                        radius={5}
                        accessibilityLabel={textFor('matchDetail.marketView', 'Market view (from odds)')}
                    />
                    <View style={styles.marketLabels}>
                        {labelValues.map((value, i) => (
                            <Text key={i} style={[styles.marketLabel, { color: i === 0 ? accentInk : themeColors.onSurface }]}>{value}</Text>
                        ))}
                    </View>
                </Card>
            )}

            <ExtraFields match={match} />

            {reasoningLines.length > 0 || sourceList.length > 0 ? (
                <Card style={styles.card} accessibilityLabel={textFor('matchDetail.whyPick', 'Why this pick')}>
                    <SectionTitle name="trending-up-outline" title={textFor('matchDetail.whyPick', 'Why this pick')} />
                    {reasoningLines.map((line, i) => (
                        <View key={`${i}-${line.slice(0, 20)}`} style={styles.reasonRow}>
                            <View style={[styles.reasonIcon, { backgroundColor: themeColors.glass }]}>
                                <Ionicons name="checkmark-circle-outline" size={14} color={accentInk} />
                            </View>
                            <Text style={[styles.reasonText, { color: themeColors.onSurface }]}>{line}</Text>
                        </View>
                    ))}
                    {sourceList.length > 0 ? (
                        <View style={styles.sourcesBlock}>
                            <Text style={[styles.sourcesLabel, { color: themeColors.textSecondary }]}>
                                {textFor('matchDetail.sources', 'Sources')}
                            </Text>
                            <View style={styles.sourcesRow}>
                                {sourceList.map((s) => (
                                    <TouchableOpacity
                                        key={s.key}
                                        style={[styles.sourceChip, { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border }]}
                                        onPress={() => void Linking.openURL(s.url)}
                                        accessibilityRole="link"
                                        accessibilityLabel={s.domain}
                                    >
                                        <Text style={[styles.sourceChipText, { color: themeColors.onSurface }]} numberOfLines={1}>
                                            {s.domain}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    ) : null}
                </Card>
            ) : null}
        </View>
    );
}

/**
 * Error screen for the match page — shown when the lookup throws. Has Back,
 * Retry and a "Copy error details" button. Rendered inside the page's own
 * ErrorBoundary, so it also covers render-time exceptions on this screen.
 */
function MatchPageErrorScreen({
    error,
    onBack,
    onRetry,
}: {
    error: { message: string; stack?: string };
    onBack: () => void;
    onRetry: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const copyDetails = () => {
        const stack = (error.stack ?? '').split('\n').slice(0, 15).join('\n').trim();
        const details = [error.message.trim(), stack].filter(Boolean).join('\n');
        if (details) {
            void setClipboardString(details);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['left', 'right']}>
            <View style={styles.unavailableWrap}>
                <Ionicons name="alert-circle-outline" size={28} color={themeColors.accent} />
                <Text style={[styles.unavailableTitle, { color: themeColors.onSurface }]}>
                    {textFor('matchDetail.errorTitle', 'Couldn’t load match')}
                </Text>
                <Text style={[styles.unavailableText, { color: themeColors.textSecondary }]}>
                    {error.message || textFor('matchDetail.errorBody', 'Something went wrong while loading this match.')}
                </Text>
                <View style={styles.errorCtaRow}>
                    <AppButton onPress={onBack} style={styles.cta}>
                        {textFor('matchDetail.goBack', 'Go back')}
                    </AppButton>
                    <AppButton onPress={onRetry} style={styles.cta}>
                        {textFor('matchDetail.retry', 'Retry')}
                    </AppButton>
                    <AppButton onPress={copyDetails} style={styles.cta}>
                        {textFor('matchDetail.copyError', 'Copy error details')}
                    </AppButton>
                </View>
            </View>
        </SafeAreaView>
    );
}

function SectionTitle({ name, title, color }: { name: IonName; title: string; color?: string }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    return (
        <View style={styles.sectionTitleRow}>
            <Ionicons name={name} size={14} color={color ?? readableAccent(themeColors)} />
            <Text style={[styles.sectionTitleText, { color: themeColors.onSurface }]}>{title}</Text>
        </View>
    );
}

function LockedPickCard({ lockTier, onUnlock }: { lockTier: string; onUnlock: () => void }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);
    return (
        <Card style={styles.card} accessibilityLabel={textFor('matchDetail.lockedTitle', 'Prediction locked')}>
            <View style={styles.pickHeader}>
                <Ionicons name="lock-closed-outline" size={18} color={accentInk} />
                <Text style={[styles.pickCardTitle, { color: themeColors.onSurface }]}>{textFor('matchDetail.lockedTitle', 'Prediction locked')}</Text>
            </View>
            <AppButton
                onPress={onUnlock}
                style={styles.unlockBtn}
                radius={14}
                accessibilityLabel={lockTier === 'vip' ? textFor('matchDetail.unlockVip', 'Unlock with VIP') : textFor('matchDetail.unlockPremium', 'Unlock with Premium')}
            >
                {lockTier === 'vip' ? textFor('matchDetail.unlockVip', 'Unlock with VIP') : textFor('matchDetail.unlockPremium', 'Unlock with Premium')}
            </AppButton>
        </Card>
    );
}

function PickCard({
    pickText,
    suggestedBet,
    oddValues,
}: {
    pickText: string | undefined;
    suggestedBet?: string;
    oddValues: { label: string; value?: string }[];
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);

    return (
        <Card style={styles.card} accessibilityLabel={textFor('matchDetail.pick', 'Pick')}>
            <SectionTitle name="trending-up-outline" title={textFor('matchDetail.pick', 'Pick')} color={accentInk} />
            <Text style={[styles.pickValue, { color: themeColors.onSurface }]} numberOfLines={3}>
                {pickText}
            </Text>
            {suggestedBet ? (
                <Pill label={`${textFor('matchDetail.suggestedBet', 'Suggested bet')}: ${suggestedBet}`} tone="accent" />
            ) : null}

            <View style={styles.oddsRow}>
                {oddValues.map((v, i) => (
                    <Text key={i} style={[styles.oddsStaticVal, i === 0 ? { color: accentInk } : { color: themeColors.onSurface }]}>
                        {v.value}
                    </Text>
                ))}
            </View>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// Extras grid
// ---------------------------------------------------------------------------

interface ExtraRow {
    key: string;
    name: IonName;
    label: string;
    full?: boolean;
    content?: ReactNode;
}

function ExtraFields({ match }: { match: MatchViewModel }) {
    const { themeColors } = useTheme();
    const accentInk = readableAccent(themeColors);
    const rows = buildExtraRows(match, themeColors, accentInk);
    const styles = getStyles(themeColors);
    if (rows.length === 0) return null;

    const renderCard = (row: ExtraRow) => (
        <Card
            key={row.key}
            padded={false}
            radius={14}
            style={[styles.extraCard, row.full ? styles.extraCardFull : styles.extraCardCol]}
            accessibilityLabel={row.label}
        >
            <SectionTitle name={row.name} title={row.label} color={accentInk} />
            {row.content}
        </Card>
    );

    const gridRows = rows.filter((r) => !r.full);
    const fullRows = rows.filter((r) => r.full);
    const pairs: ({ left?: ExtraRow; right?: ExtraRow })[] = [];
    for (let i = 0; i < gridRows.length; i += 2) {
        pairs.push({ left: gridRows[i], right: gridRows[i + 1] });
    }

    return (
        <View style={styles.extraGrid}>
            {pairs.map((pair, i) => (
                <View key={i} style={styles.extraPair}>
                    {pair.left ? renderCard(pair.left) : <View style={styles.extraCol} />}
                    {pair.right ? renderCard(pair.right) : <View style={styles.extraCol} />}
                </View>
            ))}
            {fullRows.map((row) => renderCard(row))}
        </View>
    );
}

function FormBadge({ char, themeColors }: { char: string; themeColors: ThemeColors }) {
    const styles = getStyles(themeColors);
    const color = char === 'W' ? themeColors.success : char === 'D' ? themeColors.warning : themeColors.danger;
    return (
        <View style={[styles.formBadge, { backgroundColor: color }]}>
            <Text style={[styles.formBadgeText, { color: onColor(color) }]}>{char}</Text>
        </View>
    );
}

function buildExtraRows(match: MatchViewModel, themeColors: ThemeColors, accentInk: string): ExtraRow[] {
    const rows: ExtraRow[] = [];
    const styles = getStyles(themeColors);
    const onText = themeColors.onSurface;
    const muted = themeColors.textSecondary;

    // Normalized, null-safe views of the rich detail data.
    const potentials = normalizePotentials(match.potentials);
    const h2h = normalizeH2h(match.h2h);
    const h2hSummary = h2h.summary;
    const h2hHistory = h2h.history ?? [];
    const stats = normalizeStats(match.stats);
    const homeXg = xgOf(match.homeXg);
    const awayXg = xgOf(match.awayXg);

    // Standings and TV stations (kept from the other branch's version).
    const homeStanding = toFiniteNumber(match.homeStanding);
    const awayStanding = toFiniteNumber(match.awayStanding);
    if (homeStanding !== null || awayStanding !== null) {
        rows.push({
            key: 'standings',
            name: 'medal-outline',
            label: textFor('matchDetail.standings', 'Standings'),
            content: (
                <View style={styles.h2hRow}>
                    {homeStanding !== null && (
                        <View style={styles.h2hStat}>
                            <Text style={[styles.h2hVal, { color: accentInk }]}>#{homeStanding}</Text>
                            <Text style={[styles.h2hLabel, { color: muted }]}>{match.homeTeam}</Text>
                        </View>
                    )}
                    {awayStanding !== null && (
                        <View style={styles.h2hStat}>
                            <Text style={[styles.h2hVal, { color: onText }]}>#{awayStanding}</Text>
                            <Text style={[styles.h2hLabel, { color: muted }]}>{match.awayTeam}</Text>
                        </View>
                    )}
                </View>
            ),
        });
    }

    const tvStations = Array.isArray(match.tvStations) ? match.tvStations : [];
    if (tvStations.length > 0) {
        rows.push({
            key: 'tv',
            name: 'tv-outline',
            label: textFor('matchDetail.tv', 'TV'),
            content: (
                <View style={styles.h2hRow}>
                    <Text style={[styles.h2hVal, { color: accentInk }]}>{tvStations.join(', ')}</Text>
                </View>
            ),
        });
    }

    if (potentials.length > 0) {
        rows.push({
            key: 'potentials',
            name: 'stats-chart-outline',
            label: textFor('matchDetail.potentials', 'Predicted probabilities'),
            full: true,
            content: (
                <View style={styles.extraList}>
                    {potentials.map((p, i) => (
                        <View key={i} style={styles.extraListItem}>
                            <Text style={[styles.potentialLabel, { color: onText }]} numberOfLines={1}>{p.label}</Text>
                            <ProgressBar value={p.percent ?? 0} height={8} radius={4} style={styles.potentialTrack} />
                            <Text style={[styles.pctText, { color: onText }]}>{p.percent !== undefined ? `${p.percent}%` : p.value}</Text>
                        </View>
                    ))}
                </View>
            ),
        });
    }

    if (h2hSummary) {
        const s = h2hSummary;
        rows.push({
            key: 'h2h-summary',
            name: 'flag-outline',
            label: textFor('matchDetail.h2hSummary', 'Head to head'),
            content: (
                <View style={styles.h2hRow}>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: accentInk }]}>{s.wins}</Text>
                        <Text style={[styles.h2hLabel, { color: muted }]}>{textFor('matchDetail.homeWins', 'HOME WINS')}</Text>
                    </View>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: onText }]}>{s.draws}</Text>
                        <Text style={[styles.h2hLabel, { color: muted }]}>{textFor('matchDetail.draws', 'DRAWS')}</Text>
                    </View>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: onText }]}>{s.losses}</Text>
                        <Text style={[styles.h2hLabel, { color: muted }]}>{textFor('matchDetail.awayWins', 'AWAY WINS')}</Text>
                    </View>
                </View>
            ),
        });
    }

    if (homeFormRaw(match.homeForm)) {
        rows.push({
            key: 'form-home',
            name: 'analytics-outline',
            label: `${match.homeTeam} — ${textFor('matchDetail.form', 'Recent form')}`,
            content: <FormStreak form={homeFormRaw(match.homeForm)} />,
        });
    }
    if (homeFormRaw(match.awayForm)) {
        rows.push({
            key: 'form-away',
            name: 'analytics-outline',
            label: `${match.awayTeam} — ${textFor('matchDetail.form', 'Recent form')}`,
            content: <FormStreak form={homeFormRaw(match.awayForm)} />,
        });
    }

    if (match.homeXg !== undefined || match.awayXg !== undefined) {
        rows.push({
            key: 'xg',
            name: 'analytics-outline',
            label: textFor('matchDetail.xg', 'Expected goals (xG)'),
            content: (
                <View style={styles.xgRow}>
                    <Text style={[styles.xgVal, { color: accentInk }]}>{homeXg.toFixed(2)}</Text>
                    <Text style={[styles.xgLabel, { color: muted }]}>{textFor('matchDetail.home', 'HOME')}</Text>
                    <Text style={[styles.xgVal, { color: onText }]}>{awayXg.toFixed(2)}</Text>
                    <Text style={[styles.xgLabel, { color: muted }]}>{textFor('matchDetail.away', 'AWAY')}</Text>
                </View>
            ),
        });
    }

    if (h2hHistory.length > 0) {
        rows.push({
            key: 'h2h-history',
            name: 'flag-outline',
            label: textFor('matchDetail.h2hHistory', 'H2H HISTORY'),
            full: true,
            content: (
                <View style={styles.h2hHistoryCard}>
                    {h2hHistory.map((h, i) => (
                        <View key={i} style={[styles.h2hHistoryRow, i > 0 && { borderTopWidth: 1, borderTopColor: themeColors.border }]}>
                            <View style={styles.h2hHistoryLeft}>
                                <Text style={[styles.h2hHistoryLeague, { color: muted }]}>{h.league}</Text>
                                <Text style={[styles.h2hHistoryTeams, { color: onText }]}>{h.home} vs {h.away}</Text>
                            </View>
                            <View style={styles.h2hHistoryRight}>
                                <Text style={[styles.h2hHistoryScore, { color: accentInk }]}>{h.score}</Text>
                                <Text style={[styles.h2hHistoryDate, { color: muted }]}>{h.date}</Text>
                            </View>
                        </View>
                    ))}
                </View>
            ),
        });
    }

    const homeLineup = normalizeLineups(match.homeLineup);
    const awayLineup = normalizeLineups(match.awayLineup);
    if (homeLineup.length > 0 || awayLineup.length > 0) {
        rows.push({
            key: 'lineups',
            name: 'flashlight-outline',
            label: textFor('matchDetail.lineups', 'Starting lineups'),
            full: true,
            content: (
                <View style={styles.lineupCols}>
                    <View style={styles.lineupCol}>
                        <Text style={[styles.lineupTeam, { color: accentInk }]} numberOfLines={1}>{match.homeTeam}</Text>
                        {homeLineup.map((p, i) => (
                            <Text key={i} style={[styles.lineupPlayer, { color: onText }]} numberOfLines={1}>
                                {p.number !== undefined ? `${p.number}. ` : ''}{p.name}
                            </Text>
                        ))}
                    </View>
                    <View style={styles.lineupDivider} />
                    <View style={styles.lineupCol}>
                        <Text style={[styles.lineupTeam, { color: onText }]} numberOfLines={1}>{match.awayTeam}</Text>
                        {awayLineup.map((p, i) => (
                            <Text key={i} style={[styles.lineupPlayer, { color: onText }]} numberOfLines={1}>
                                {p.number !== undefined ? `${p.number}. ` : ''}{p.name}
                            </Text>
                        ))}
                    </View>
                </View>
            ),
        });
    }

    if (stats.length > 0) {
        rows.push({
            key: 'stats',
            name: 'stats-chart-outline',
            label: textFor('matchDetail.matchStats', 'Match stats'),
            full: true,
            content: (
                <View style={styles.statsCard}>
                    {stats.map((s, i) => {
                        const total = (s.home + s.away) || 1;
                        const homePct = clampPercent((s.home / total) * 100);
                        return (
                            <View key={i} style={styles.statBlock}>
                                <View style={styles.statValues}>
                                    <Text style={[styles.statNum, { color: onText }]}>{s.home}{s.percent ? '%' : ''}</Text>
                                    <Text style={[styles.statLabel, { color: muted }]}>{s.label}</Text>
                                    <Text style={[styles.statNum, { color: onText }]}>{s.away}{s.percent ? '%' : ''}</Text>
                                </View>
                                <ProgressBar value={homePct} height={6} radius={3} />
                            </View>
                        );
                    })}
                </View>
            ),
        });
    }

    const homeCorners = toFiniteNumber(match.homeCorners);
    const awayCorners = toFiniteNumber(match.awayCorners);
    if (homeCorners !== null || awayCorners !== null) {
        rows.push({
            key: 'corners',
            name: 'analytics-outline',
            label: textFor('matchDetail.cornerStats', 'Corner stats'),
            content: (
                <View style={styles.h2hRow}>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: accentInk }]}>{homeCorners ?? 0}</Text>
                        <Text style={[styles.h2hLabel, { color: muted }]}>{match.homeTeam}</Text>
                    </View>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: onText }]}>{awayCorners ?? 0}</Text>
                        <Text style={[styles.h2hLabel, { color: muted }]}>{match.awayTeam}</Text>
                    </View>
                </View>
            ),
        });
    }

    return rows;
}

/** Form string for a match field — guarded, empty when missing/invalid. */
function homeFormRaw(value: unknown): string {
    return formString(value);
}

function FormStreak({ form }: { form: string }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    return (
        <View style={styles.streakRow}>
            {form.split('').slice(0, 5).map((char, i) => (
                <FormBadge key={i} char={char} themeColors={themeColors} />
            ))}
        </View>
    );
}

function H2HContent({ match }: { match: MatchViewModel }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const { summary, history } = normalizeH2h(match.h2h);
    if (!summary && (!history || history.length === 0)) return null;
    return (
        <Card style={styles.card}>
            <SectionTitle name="flag-outline" title={textFor('matchDetail.h2hCard', 'HEAD TO HEAD')} />
            <View style={styles.h2hRow}>
                <View style={styles.h2hStat}>
                    <Text style={[styles.h2hVal, { color: themeColors.onSurface }]}>{summary?.wins ?? 0}</Text>
                    <Text style={[styles.h2hLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.homeWins', 'HOME WINS')}</Text>
                </View>
                <View style={styles.h2hStat}>
                    <Text style={[styles.h2hVal, { color: themeColors.onSurface }]}>{summary?.draws ?? 0}</Text>
                    <Text style={[styles.h2hLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.draws', 'DRAWS')}</Text>
                </View>
                <View style={styles.h2hStat}>
                    <Text style={[styles.h2hVal, { color: themeColors.onSurface }]}>{summary?.losses ?? 0}</Text>
                    <Text style={[styles.h2hLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.awayWins', 'AWAY WINS')}</Text>
                </View>
            </View>
            {history && history.length > 0 ? (
                <View style={styles.h2hHistoryCard}>
                    {history.map((h, i) => (
                        <View key={i} style={[styles.h2hHistoryRow, i > 0 && { borderTopWidth: 1, borderTopColor: themeColors.border }]}>
                            <View style={styles.h2hHistoryLeft}>
                                <Text style={[styles.h2hHistoryLeague, { color: themeColors.textSecondary }]}>{h.league}</Text>
                                <Text style={[styles.h2hHistoryTeams, { color: themeColors.onSurface }]}>{h.home} vs {h.away}</Text>
                            </View>
                            <View style={styles.h2hHistoryRight}>
                                <Text style={[styles.h2hHistoryScore, { color: readableAccent(themeColors) }]}>{h.score}</Text>
                                <Text style={[styles.h2hHistoryDate, { color: themeColors.textSecondary }]}>{h.date}</Text>
                            </View>
                        </View>
                    ))}
                </View>
            ) : null}
        </Card>
    );
}

function FormContent({ match }: { match: MatchViewModel }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);

    if (!match.homeForm && !match.awayForm) return null;

    return (
        <View style={styles.formContent}>
            {match.homeForm ? (
                <Card style={styles.card}>
                    <SectionTitle name="analytics-outline" title={`${match.homeTeam} — ${textFor('matchDetail.form', 'Recent form')}`} color={accentInk} />
                    <FormStreak form={match.homeForm} />
                </Card>
            ) : null}
            {match.awayForm ? (
                <Card style={styles.card}>
                    <SectionTitle name="analytics-outline" title={`${match.awayTeam} — ${textFor('matchDetail.form', 'Recent form')}`} color={accentInk} />
                    <FormStreak form={match.awayForm} />
                </Card>
            ) : null}
        </View>
    );
}

function StatsContent({ match }: { match: MatchViewModel }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const stats = normalizeStats(match.stats);
    if (stats.length === 0) return null;
    return (
        <Card style={styles.card}>
            <SectionTitle name="stats-chart-outline" title={textFor('matchDetail.matchStats', 'Match stats')} />
            <View style={styles.statsCard}>
                {stats.map((s, i) => {
                    const total = (s.home + s.away) || 1;
                    const homePct = clampPercent((s.home / total) * 100);
                    return (
                        <View key={i} style={styles.statBlock}>
                            <View style={styles.statValues}>
                                <Text style={[styles.statNum, { color: themeColors.onSurface }]}>{s.home}{s.percent ? '%' : ''}</Text>
                                <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{s.label}</Text>
                                <Text style={[styles.statNum, { color: themeColors.onSurface }]}>{s.away}{s.percent ? '%' : ''}</Text>
                            </View>
                            <ProgressBar value={homePct} height={6} radius={3} />
                        </View>
                    );
                })}
            </View>
        </Card>
    );
}

function textFor(key: string, fallback: string): string {
    const value = i18n.t(key);
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// Odds tab
// ---------------------------------------------------------------------------

function OddsContent({ match }: { match: MatchViewModel }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);
    const dOdds = normalizeDetailedOdds(match.detailedOdds);

    const values1x2 = ['home', 'draw', 'away'] as const;
    const cellValue = (val: string) => val || '—';

    return (
        <View style={styles.oddsTab}>
            {dOdds && (
                <View style={styles.oddsGrid}>
                    <Card style={styles.oddsTile} padded={false}>
                        <Text style={[styles.tileLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.fullTime12', 'FULL TIME 1X2')}</Text>
                        <View style={styles.oddsRow}>
                            {values1x2.map((side, i) => (
                                <View key={side} style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.onSurface }]}>{cellValue(dOdds.ft?.['1x2']?.[side])}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>
                                        {side === 'home' ? textFor('matchDetail.home', 'HOME') : side === 'draw' ? textFor('matchDetail.draw', 'DRAW') : textFor('matchDetail.away', 'AWAY')}
                                    </Text>
                                    {i < 2 ? <View style={styles.oddsDivider} /> : null}
                                </View>
                            ))}
                        </View>
                    </Card>
                    {dOdds.ft?.ou && (
                        <Card style={styles.oddsTile} padded={false}>
                            <Text style={[styles.tileLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.overUnder', 'GOALS OVER / UNDER')}</Text>
                            <View style={styles.oddsRow}>
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: accentInk }]}>{cellValue(dOdds.ft.ou.over)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>{textFor('matchDetail.over', 'OVER')} {dOdds.ft.ou.line}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.onSurface }]}>{cellValue(dOdds.ft.ou.under)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>{textFor('matchDetail.under', 'UNDER')} {dOdds.ft.ou.line}</Text>
                                </View>
                            </View>
                        </Card>
                    )}
                    {dOdds.ft?.ah && (
                        <Card style={styles.oddsTile} padded={false}>
                            <Text style={[styles.tileLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.asianHandicap', 'FT ASIAN HANDICAP')}</Text>
                            <View style={styles.oddsRow}>
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: accentInk }]}>{cellValue(dOdds.ft.ah.home)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>{textFor('matchDetail.home', 'HOME')}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.onSurface }]}>{cellValue(dOdds.ft.ah.away)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>{textFor('matchDetail.away', 'AWAY')}</Text>
                                </View>
                            </View>
                        </Card>
                    )}
                    {dOdds.ht?.['1x2'] && (
                        <Card style={styles.oddsTile} padded={false}>
                            <Text style={[styles.tileLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.halfTime12', 'HALF TIME 1X2')}</Text>
                            <View style={styles.oddsRow}>
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: accentInk }]}>{cellValue(dOdds.ht['1x2'].home)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>{textFor('matchDetail.home', 'HOME')}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.onSurface }]}>{cellValue(dOdds.ht['1x2'].draw)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>{textFor('matchDetail.draw', 'DRAW')}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.onSurface }]}>{cellValue(dOdds.ht['1x2'].away)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.textSecondary }]}>{textFor('matchDetail.away', 'AWAY')}</Text>
                                </View>
                            </View>
                        </Card>
                    )}
                </View>
            )}
        </View>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        // Shell
        container: { flex: 1, backgroundColor: themeColors.background },

        // Unavailable / error state
        unavailableWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
        unavailableText: { fontSize: 15, textAlign: 'center' },
        unavailableTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
        backCta: {
            height: 44,
            paddingHorizontal: 16,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: themeColors.border,
            marginTop: 12,
        },
        errorCtaRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 },
        cta: { flex: 1 },

        // Header — reference B
        headerWrap: { marginHorizontal: 14, marginTop: 10, marginBottom: 6 },
        headerCard: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 12 },
        headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        roundBtn: {
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
        },
        roundBtnOut: {
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: themeColors.border,
            backgroundColor: themeColors.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
        },
        headerMeta: { flex: 1, alignItems: 'center' },
        competition: { fontSize: 14, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center' },
        teamBlocksRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: 16, marginTop: 6 },
        teamBlock: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
        teamNameBig: {
            fontSize: 15,
            fontWeight: '700',
            lineHeight: 19,
            textAlign: 'center',
        },
        timeWrap: { flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 90 },
        timeBig: { fontSize: 26, fontWeight: '800', letterSpacing: -1, textAlign: 'center', includeFontPadding: false },
        timeDate: { fontSize: 11, fontWeight: '500', textAlign: 'center' },
        ftText: { fontSize: 22, fontWeight: '800', textAlign: 'center', includeFontPadding: false },
        scoreBig: { fontSize: 26, fontWeight: '800', letterSpacing: -1, textAlign: 'center', includeFontPadding: false },
        statusRow: { alignItems: 'center', marginTop: 2 },

        // Content shell
        content: { flex: 1 },
        scrollContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 48 },
        overviewContent: { gap: 14 },
        card: { gap: 8 },

        // Pick card
        sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        sectionTitleText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
        pickHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        pickCardTitle: { fontSize: 15, fontWeight: '700' },
        pickValue: { fontSize: 17, fontWeight: '800', lineHeight: 24 },
        oddsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        oddsStaticVal: { fontSize: 14, fontWeight: '800', minWidth: 40, fontVariant: ['tabular-nums'] },
        pctText: { fontSize: 13, fontWeight: '700', minWidth: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
        marketLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 4 },
        marketLabel: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

        // Empty state
        emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40 },
        emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
        emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

        // Why this pick + sources
        reasonRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
        reasonIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
        reasonText: { flex: 1, fontSize: 13, lineHeight: 20 },
        sourcesBlock: {
            marginTop: 6,
            paddingTop: 12,
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: themeColors.border,
        },
        sourcesLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
        sourcesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        sourceChip: {
            minHeight: 44,
            maxWidth: 180,
            paddingHorizontal: 12,
            borderRadius: 14,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
        },
        sourceChipText: { fontSize: 12, fontWeight: '600' },

        // Locked card
        unlockBtn: { marginTop: 4 },

        // Extras grid
        extraGrid: { gap: 10 },
        extraPair: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
        extraCol: { flex: 1 },
        extraCard: { padding: 14, flex: 1 },
        extraCardFull: { alignItems: 'stretch' },
        extraCardCol: { alignItems: 'center' },
        extraList: { gap: 8 },
        extraListItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        potentialLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
        potentialTrack: { flex: 1 },
        streakRow: { flexDirection: 'row', gap: 4 },
        formBadge: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
        formBadgeText: { fontSize: 10, fontWeight: '700' },
        xgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: 6 },
        xgVal: { fontSize: 22, fontWeight: '800' },
        xgLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
        h2hRow: { flexDirection: 'row', justifyContent: 'space-around', gap: 6 },
        h2hStat: { alignItems: 'center', gap: 4 },
        h2hVal: { fontSize: 20, fontWeight: '800' },
        h2hLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center' },
        h2hHistoryCard: { gap: 0 },
        h2hHistoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
        h2hHistoryLeft: { flex: 1 },
        h2hHistoryLeague: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
        h2hHistoryTeams: { fontSize: 12, fontWeight: '600' },
        h2hHistoryRight: { alignItems: 'flex-end' },
        h2hHistoryScore: { fontSize: 14, fontWeight: '700' },
        h2hHistoryDate: { fontSize: 9, fontWeight: '500', marginTop: 2 },
        lineupCols: { flexDirection: 'row' },
        lineupCol: { flex: 1, gap: 6 },
        lineupDivider: { width: 1, marginHorizontal: 12, backgroundColor: themeColors.border },
        lineupTeam: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
        lineupPlayer: { fontSize: 12, fontWeight: '500' },
        statsCard: { gap: 10 },
        statBlock: { gap: 4 },
        statValues: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        statNum: { fontSize: 13, fontWeight: '700' },
        statLabel: { fontSize: 10, fontWeight: '500', letterSpacing: 0.5 },

        // Form tab
        formContent: { gap: 14 },

        // Odds tab
        oddsTab: { gap: 10 },
        oddsGrid: { gap: 10 },
        oddsTile: { padding: 16 },
        tileLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 12 },
        oddsCell: { alignItems: 'center', flex: 1 },
        oddsDivider: { width: 1, height: 30, backgroundColor: themeColors.border },
        oddsVal: { fontSize: 15, fontWeight: '800' },
        oddsSub: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 },
    });
}
