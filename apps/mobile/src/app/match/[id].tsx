/**
 * Match overview page — design system version (reference B).
 *
 * Header: round back button left, round accent-filled action right, centred
 * secondary competition name; the two teams (crest 64px + bold name under)
 * around a large bold kickoff time with the date under it (finished matches:
 * a large score with FT).
 *
 * History rule: FINISHED matches (status FT/AET/PEN or a result of win,
 * lose, draw or void) show pick, confidence, reasoning and sources for ALL
 * tiers — never "Unlock with VIP" or "Prediction locked".
 *
 * Tabs: Overview, Prediction (lock icon when locked), and Form/H2H or Stats
 * only if data exists. Prediction tab: pick, suggested bet, confidence
 * (ProgressBar), risk pill (Low/Medium/High, hidden when unknown), reasons as
 * check rows, sources as small tappable domain chips. When locked: placeholder
 * bars plus one unlock card linking to the Store.
 */

import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
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

type MatchViewModel = Omit<
    ApiMatch,
    'h2h' | 'detailedOdds' | 'homeLineup' | 'awayLineup' | 'goals' | 'stats' | 'potentials' | 'oddsComparison'
> &
    Partial<MatchDetailData> & {
        // Raw web payload key; the camelCase field is the mapped shape.
        ai_prediction?: { sources?: string[] };
    };

type AiPrediction = NonNullable<MatchViewModel['aiPrediction']>;
type Risk = AiPrediction['risk'];
type Odds13 = { home?: string; draw?: string; away?: string };

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' });
}

function domainOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        const host = url.replace(/^https?:\/\//, '').split('/')[0];
        return host.replace(/^www\./, '');
    }
}

function isFinishedStatus(status?: string): boolean {
    return status === 'Finished' || status === 'FT' || status === 'AET' || status === 'PEN';
}

function isFinishedMatch(match: MatchViewModel): boolean {
    return isFinishedStatus(match.status) || (match.result !== undefined && match.result !== 'pending');
}

export default function MatchDetailScreen() {
    const { id, matchData } = useLocalSearchParams();
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);
    const access = useMembershipAccess();

    const [match, setMatch] = useState<MatchViewModel | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('overview');

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;

            const loadMatch = async () => {
                setLoading(true);

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
                    const remoteMatch = await api.matches.byId(id as string);
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
                    console.warn('[Match Detail] Match lookup failed:', apiError);
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
                    console.warn('[Match Detail] match-stats fetch failed:', statsError);
                }

                if (!cancelled) setLoading(false);
            };

            void loadMatch();
            return () => { cancelled = true; };
        }, [id, matchData]),
    );

    // ---- Derived state (hooks first, so ordering stays stable) ----
    const isLive = match?.status?.includes('Live') || match?.status === 'Halftime' || match?.status === 'HT';
    const isFinished = isFinishedMatch(match as MatchViewModel);
    const odds1x2: Odds13 | undefined = match?.detailedOdds?.ft?.['1x2'];
    const hasDetailedOdds = Boolean(
        (odds1x2?.home && odds1x2.home !== '') ||
        (odds1x2?.draw && odds1x2.draw !== '') ||
        (odds1x2?.away && odds1x2.away !== ''),
    );
    const kickoff = match ? new Date(match.timestamp) : new Date(0);
    const kickMs = match ? kickoff.getTime() : 0;

    const rawSources = match?.aiPrediction?.sources ?? match?.ai_prediction?.sources;
    const sources = useMemo(
        () => (Array.isArray(rawSources) ? rawSources.filter(Boolean) : []),
        [rawSources],
    );
    const sourceList = useMemo(
        () => sources.map((s) => ({ key: s, domain: domainOf(s), url: s })),
        [sources],
    );

    const homeForm = match?.homeForm || '';
    const awayForm = match?.awayForm || '';

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

    const ai = match.aiPrediction;
    const pickText = ai?.pick || ai?.suggestedBet || ai?.prediction;
    const hasPrediction = typeof pickText === 'string' && pickText.trim().length > 0;
    const confidence = typeof ai?.confidence === 'number' ? Math.max(0, Math.min(100, ai.confidence)) : undefined;
    const risk = ai?.risk;
    const reasoningLines = Array.isArray(ai?.reasoning) ? ai.reasoning.filter(Boolean) : [];

    const scoreText = (match.homeScore !== undefined && match.awayScore !== undefined)
        ? `${match.homeScore} - ${match.awayScore}`
        : '';
    const showScore = (isLive || isFinished) && match.homeScore !== undefined && match.awayScore !== undefined;

    const shareUrl = `trophy-games://match/${match.id}`;
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
                                    <Text style={[styles.scoreBig, { color: themeColors.onSurface }]}>{scoreText}</Text>
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
                        confidence={confidence}
                        risk={risk}
                        reasoningLines={reasoningLines}
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
// Overview tab (reference B: pick, suggested bet, confidence bar + %, risk,
// reasons as check rows, sources as tappable chips)
// ---------------------------------------------------------------------------

function OverviewContent({
    match,
    isFinished,
    accessLoading,
    hasPrediction,
    pickText,
    confidence,
    risk,
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
    confidence: number | undefined;
    risk: Risk;
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

    const oddValues: { label: string; value?: string }[] = [];
    const dOdds: Odds13 | undefined = match.detailedOdds?.ft?.['1x2'];
    if (dOdds?.home) oddValues.push({ label: textFor('matchDetail.home', 'HOME'), value: dOdds.home });
    if (dOdds?.draw) oddValues.push({ label: textFor('matchDetail.draw', 'DRAW'), value: dOdds.draw });
    if (dOdds?.away) oddValues.push({ label: textFor('matchDetail.away', 'AWAY'), value: dOdds.away });

    const marketTotal = oddValues.reduce((acc, v) => acc + (Number.parseFloat(v.value ?? '') || 0), 0);

    return (
        <View style={styles.overviewContent}>
            <PickCard
                pickText={pickText}
                confidence={confidence}
                risk={risk}
                suggestedBet={match.aiPrediction?.suggestedBet}
                oddValues={oddValues}
            />

            {marketTotal > 0 && oddValues[0]?.value !== undefined && (
                <Card style={styles.card} accessibilityLabel={textFor('matchDetail.marketView', 'Market view (from odds)')}>
                    <SectionTitle name="stats-chart-outline" title={textFor('matchDetail.marketView', 'Market view (from odds)')} />
                    <ProgressBar
                        value={(Number.parseFloat(oddValues[0].value ?? '') / marketTotal) * 100}
                        height={10}
                        radius={5}
                        accessibilityLabel={textFor('matchDetail.marketView', 'Market view (from odds)')}
                    />
                    <View style={styles.marketLabels}>
                        {oddValues.map((v, i) => (
                            <Text key={i} style={[styles.marketLabel, { color: i === 0 ? accentInk : themeColors.onSurface }]}>{v.value}</Text>
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
    confidence,
    risk,
    suggestedBet,
    oddValues,
}: {
    pickText: string | undefined;
    confidence: number | undefined;
    risk: Risk;
    suggestedBet?: string;
    oddValues: { label: string; value?: string }[];
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accentInk = readableAccent(themeColors);

    const riskTone = risk === 'low' ? 'success' : risk === 'medium' ? 'warning' : risk === 'high' ? 'danger' : 'neutral';
    const riskLabel = risk ? textFor(`risk.${risk}`, risk) : '';

    return (
        <Card style={styles.card} accessibilityLabel={textFor('matchDetail.pick', 'Pick')}>
            <SectionTitle name="trending-up-outline" title={textFor('matchDetail.pick', 'Pick')} color={accentInk} />
            <Text style={[styles.pickValue, { color: themeColors.onSurface }]} numberOfLines={3}>
                {pickText}
            </Text>
            {suggestedBet ? (
                <Pill label={`${textFor('matchDetail.suggestedBet', 'Suggested bet')}: ${suggestedBet}`} tone="accent" />
            ) : null}

            <View style={styles.confidenceWrap}>
                <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.confidence', 'Confidence')}</Text>
                <ProgressBar
                    value={confidence ?? 0}
                    height={8}
                    radius={4}
                    accessibilityLabel={textFor('matchDetail.confidence', 'Confidence')}
                />
                <Text style={[styles.pctText, { color: themeColors.onSurface }]}>
                    {confidence !== undefined ? `${Math.round(confidence)}%` : '—'}
                </Text>
            </View>

            {riskLabel ? (
                <View style={styles.riskRow}>
                    <Text style={[styles.fieldLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.risk', 'Risk')}</Text>
                    <Pill label={riskLabel} tone={riskTone} />
                </View>
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

    if (match.potentials && match.potentials.length > 0) {
        rows.push({
            key: 'potentials',
            name: 'stats-chart-outline',
            label: textFor('matchDetail.potentials', 'Predicted probabilities'),
            full: true,
            content: (
                <View style={styles.extraList}>
                    {match.potentials.map((p, i) => (
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

    const h2h = match.h2h;
    if (h2h?.summary) {
        const s = h2h.summary;
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

    if (match.homeForm) {
        rows.push({
            key: 'form-home',
            name: 'analytics-outline',
            label: `${match.homeTeam} — ${textFor('matchDetail.form', 'Recent form')}`,
            content: <FormStreak form={match.homeForm} />,
        });
    }
    if (match.awayForm) {
        rows.push({
            key: 'form-away',
            name: 'analytics-outline',
            label: `${match.awayTeam} — ${textFor('matchDetail.form', 'Recent form')}`,
            content: <FormStreak form={match.awayForm} />,
        });
    }

    if (match.homeXg !== undefined || match.awayXg !== undefined) {
        rows.push({
            key: 'xg',
            name: 'analytics-outline',
            label: textFor('matchDetail.xg', 'Expected goals (xG)'),
            content: (
                <View style={styles.xgRow}>
                    <Text style={[styles.xgVal, { color: accentInk }]}>{(match.homeXg ?? 0).toFixed(2)}</Text>
                    <Text style={[styles.xgLabel, { color: muted }]}>{textFor('matchDetail.home', 'HOME')}</Text>
                    <Text style={[styles.xgVal, { color: onText }]}>{(match.awayXg ?? 0).toFixed(2)}</Text>
                    <Text style={[styles.xgLabel, { color: muted }]}>{textFor('matchDetail.away', 'AWAY')}</Text>
                </View>
            ),
        });
    }

    if (h2h?.history && h2h.history.length > 0) {
        rows.push({
            key: 'h2h-history',
            name: 'flag-outline',
            label: textFor('matchDetail.h2hHistory', 'H2H HISTORY'),
            full: true,
            content: (
                <View style={styles.h2hHistoryCard}>
                    {h2h.history.map((h, i) => (
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

    if (match.homeLineup || match.awayLineup) {
        rows.push({
            key: 'lineups',
            name: 'flashlight-outline',
            label: textFor('matchDetail.lineups', 'Starting lineups'),
            full: true,
            content: (
                <View style={styles.lineupCols}>
                    <View style={styles.lineupCol}>
                        <Text style={[styles.lineupTeam, { color: accentInk }]} numberOfLines={1}>{match.homeTeam}</Text>
                        {(match.homeLineup || []).map((p, i) => (
                            <Text key={i} style={[styles.lineupPlayer, { color: onText }]} numberOfLines={1}>
                                {p.number ? `${p.number}. ` : ''}{p.name}
                            </Text>
                        ))}
                    </View>
                    <View style={styles.lineupDivider} />
                    <View style={styles.lineupCol}>
                        <Text style={[styles.lineupTeam, { color: onText }]} numberOfLines={1}>{match.awayTeam}</Text>
                        {(match.awayLineup || []).map((p, i) => (
                            <Text key={i} style={[styles.lineupPlayer, { color: onText }]} numberOfLines={1}>
                                {p.number ? `${p.number}. ` : ''}{p.name}
                            </Text>
                        ))}
                    </View>
                </View>
            ),
        });
    }

    if (match.stats && match.stats.length > 0) {
        rows.push({
            key: 'stats',
            name: 'stats-chart-outline',
            label: textFor('matchDetail.matchStats', 'Match stats'),
            full: true,
            content: (
                <View style={styles.statsCard}>
                    {match.stats.map((s, i) => {
                        const total = (s.home + s.away) || 1;
                        const homePct = Math.round((s.home / total) * 100);
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

    if (match.homeCorners !== undefined || match.awayCorners !== undefined) {
        rows.push({
            key: 'corners',
            name: 'analytics-outline',
            label: textFor('matchDetail.cornerStats', 'Corner stats'),
            content: (
                <View style={styles.h2hRow}>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: accentInk }]}>{match.homeCorners ?? 0}</Text>
                        <Text style={[styles.h2hLabel, { color: muted }]}>{match.homeTeam}</Text>
                    </View>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: onText }]}>{match.awayCorners ?? 0}</Text>
                        <Text style={[styles.h2hLabel, { color: muted }]}>{match.awayTeam}</Text>
                    </View>
                </View>
            ),
        });
    }

    return rows;
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
    const h2h = match.h2h;
    if (!h2h) return null;
    return (
        <Card style={styles.card}>
            <SectionTitle name="flag-outline" title={textFor('matchDetail.h2hCard', 'HEAD TO HEAD')} />
            <View style={styles.h2hRow}>
                <View style={styles.h2hStat}>
                    <Text style={[styles.h2hVal, { color: themeColors.onSurface }]}>{h2h.summary?.wins ?? 0}</Text>
                    <Text style={[styles.h2hLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.homeWins', 'HOME WINS')}</Text>
                </View>
                <View style={styles.h2hStat}>
                    <Text style={[styles.h2hVal, { color: themeColors.onSurface }]}>{h2h.summary?.draws ?? 0}</Text>
                    <Text style={[styles.h2hLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.draws', 'DRAWS')}</Text>
                </View>
                <View style={styles.h2hStat}>
                    <Text style={[styles.h2hVal, { color: themeColors.onSurface }]}>{h2h.summary?.losses ?? 0}</Text>
                    <Text style={[styles.h2hLabel, { color: themeColors.textSecondary }]}>{textFor('matchDetail.awayWins', 'AWAY WINS')}</Text>
                </View>
            </View>
            {h2h.history && h2h.history.length > 0 ? (
                <View style={styles.h2hHistoryCard}>
                    {h2h.history.map((h, i) => (
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
    const stats = match.stats ?? [];
    if (stats.length === 0) return null;
    return (
        <Card style={styles.card}>
            <SectionTitle name="stats-chart-outline" title={textFor('matchDetail.matchStats', 'Match stats')} />
            <View style={styles.statsCard}>
                {stats.map((s, i) => {
                    const total = (s.home + s.away) || 1;
                    const homePct = Math.round((s.home / total) * 100);
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
    const dOdds = match.detailedOdds;

    const values1x2 = ['home', 'draw', 'away'] as const;
    const cellValue = (val: string | undefined) => val || '—';

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

        // Unavailable state
        unavailableWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
        unavailableText: { fontSize: 15, textAlign: 'center' },
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
        confidenceWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        fieldLabel: { fontSize: 13, fontWeight: '600' },
        pctText: { fontSize: 13, fontWeight: '700', minWidth: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
        riskRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
