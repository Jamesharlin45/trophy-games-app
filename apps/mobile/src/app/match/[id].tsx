/**
 * Match overview page.
 *
 * Header: back, share (system share sheet), league name, both crests, team
 * names, a VS pill with kickoff time and a live countdown within 24 h.
 * Status line: LIVE / FT / Upcoming. Background: gradient from the home team
 * colour fading into the app background.
 *
 * Tabs: "Overview" (default); "Odds" only when detailedOdds exists. The tab
 * bar is a plain list so new tabs can be added later.
 *
 * Overview: main pick card (pick, odds, confidence bar + %, risk badge,
 * market view bar), small cards in a two-column grid for extra fields,
 * "Why this pick" bullets, sources as compact chips linking the site domain.
 */

import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Share2,
    Eye,
    ChartBar,
    Goal,
    Link2,
    Lock,
    Crown,
    TrendingUp,
    Flag,
    Zap,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as ShareAPI from 'expo-sharing';
import * as Linking from 'expo-linking';
import { api } from '../../api/client';
import type { ApiMatch } from '../../api/client';
import { fetchMatchStats } from '../../api/footystats';
import type { MatchDetailData } from '../../api/footystats';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { headerBgColor, headerTextColor, readableCopy } from '../../lib/colors';
import { useTeamColors } from '../../hooks/useTeamColors';
import { useMembershipAccess } from '../../hooks/useMembershipAccess';
import { TeamCrest } from '../../components/TeamCrest';
import { VsPill } from '../../components/VsPill';
import { AnimatedBar } from '../../components/AnimatedBar';
import { OverviewTabs } from '../../components/OverviewTabs';
import { AnimatedPulse } from '../../components/AnimatedPulse';
import { SkeletonList } from '../../components/Skeleton';
import i18n from '../../locales';

type MatchViewModel = Omit<
    ApiMatch,
    'h2h' | 'detailedOdds' | 'homeLineup' | 'awayLineup' | 'goals' | 'stats' | 'potentials' | 'oddsComparison'
> &
    Partial<MatchDetailData>;

type AiPrediction = NonNullable<MatchViewModel['aiPrediction']>;
type Risk = AiPrediction['risk'];
type Odds13 = { home?: string; draw?: string; away?: string };

function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRemaining(ms: number): string {
    if (ms <= 0) return '';
    const secs = Math.floor(ms / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function useCountdown(targetMs: number): string {
    const [remaining, setRemaining] = useState(() => Math.max(0, targetMs - Date.now()));
    useEffect(() => {
        if (remaining <= 0) return undefined;
        const id = setInterval(() => {
            setRemaining((r) => Math.max(0, r - 1000));
        }, 1000);
        return () => clearInterval(id);
    }, [remaining]);
    return formatRemaining(remaining);
}

function domainOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        const host = url.replace(/^https?:\/\//, '').split('/')[0];
        return host.replace(/^www\./, '');
    }
}

function textFor(key: string, fallback: string): string {
    const value = i18n.t(key);
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export default function MatchDetailScreen() {
    const { id, matchData } = useLocalSearchParams();
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const access = useMembershipAccess();

    const [match, setMatch] = useState<MatchViewModel | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('overview');

    const teamColors = useTeamColors(match?.homeTeamLogo, match?.awayTeamLogo);

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
    const isFinished = match?.status === 'Finished' || match?.status === 'FT';
    const odds1x2: Odds13 | undefined = match?.detailedOdds?.ft?.['1x2'];
    const hasDetailedOdds = Boolean(
        (odds1x2?.home && odds1x2.home !== '') ||
        (odds1x2?.draw && odds1x2.draw !== '') ||
        (odds1x2?.away && odds1x2.away !== ''),
    );
    const kickoff = match ? new Date(match.timestamp) : new Date(0);
    const kickMs = match ? kickoff.getTime() : 0;

    // Declared before the early returns so hooks always run in the same order.
    const rawSources = match?.aiPrediction?.sources;
    const sources = useMemo(
        () => (Array.isArray(rawSources) ? rawSources.filter(Boolean) : []),
        [rawSources],
    );
    const sourceList = useMemo(
        () => sources.map((s) => ({ key: s, domain: domainOf(s), url: s })),
        [sources],
    );

    const tabs = useMemo(
        () => [
            { id: 'overview', label: textFor('matchDetail.tabOverview', 'Overview'), Icon: Eye },
            ...(hasDetailedOdds ? [{ id: 'odds', label: textFor('matchDetail.tabOdds', 'Odds'), Icon: ChartBar }] : []),
        ],
        [hasDetailedOdds],
    );
    const activeTab = tabs.find((t) => t.id === tab) ? tab : 'overview';
    const countdown = useCountdown(kickMs);

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
                    <Text style={[styles.unavailableText, { color: themeColors.mutedText }]}>
                        {i18n.t('matchDetail.unavailable')}
                    </Text>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backCta} accessibilityRole="button">
                        <Text style={[styles.backCtaText, { color: themeColors.accent }]}>{i18n.t('matchDetail.goBack')}</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const ai = match.aiPrediction;
    const pickText = ai?.pick || ai?.suggestedBet || ai?.prediction;
    const hasPrediction = typeof pickText === 'string' && pickText.trim().length > 0;
    // Locked state: only after membership status is known to be locked, so the
    // loading state can show a skeleton instead.
    const isLocked = access.loading
        ? false
        : (match.matchType === 'paid' && !access.paid) || (match.matchType === 'vip' && !access.vip);
    const lockTier = match.matchType === 'vip' ? 'vip' : 'paid';
    const confidence = typeof ai?.confidence === 'number' ? Math.max(0, Math.min(100, ai.confidence)) : undefined;
    const risk = ai?.risk;
    const reasoningLines = Array.isArray(ai?.reasoning) ? ai.reasoning.filter(Boolean) : [];

    const nowMs = Date.now();
    const showCountdown = kickMs > 0 && kickMs > nowMs && kickMs - nowMs < 24 * 60 * 60 * 1000;

    const scoreText = (match.homeScore !== undefined && match.awayScore !== undefined)
        ? `${match.homeScore} - ${match.awayScore}`
        : '';
    const showScore = (isLive || isFinished) && match.homeScore !== undefined && match.awayScore !== undefined;

    const vsLabel = isFinished
        ? textFor('matchDetail.statusFinished', 'FT')
        : isLive
            ? `${textFor('matchDetail.statusLive', 'LIVE')} • ${showScore ? scoreText : ''}`.trim()
            : `${textFor('matchDetail.vs', 'VS')} — ${kickMs > 0 ? formatTime(kickoff) : ''}`.trim();

    const statusText = isFinished
        ? textFor('matchDetail.statusFinished', 'FT')
        : isLive
            ? textFor('matchDetail.statusLive', 'LIVE')
            : textFor('matchDetail.upcoming', 'Upcoming');

    const homeColor = headerBgColor(teamColors.home, themeColors.accent);
    const awayColor = headerBgColor(teamColors.away, themeColors.accent);
    const headerText = headerTextColor(homeColor, themeColors.accentText, themeColors.text);

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
            <View style={[styles.headerBg, { backgroundColor: homeColor }]} />
            <View style={[styles.headerFade, { backgroundColor: themeColors.background }]} />
            <View style={[styles.headerAwayBlend, { backgroundColor: awayColor }]} />

            <View style={styles.headerInner}>
                <View style={styles.headerTop}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.headerLeftBtn} accessibilityRole="button">
                        <ChevronLeft size={26} color={headerText} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: headerText }]} numberOfLines={1}>
                        {match.league || textFor('matchDetail.matchDetails', 'Match Details')}
                    </Text>
                    <TouchableOpacity onPress={handleShare} style={styles.headerRightBtn} accessibilityRole="button" accessibilityLabel={textFor('matchDetail.share', 'Share')}>
                        <Share2 size={22} color={headerText} />
                    </TouchableOpacity>
                </View>

                <View style={styles.teamsRow}>
                    <TeamCrest
                        uri={match.homeTeamLogo}
                        name={match.homeTeam}
                        size={46}
                        teamColor={readableCopy(teamColors.home)}
                        fallbackColors={[themeColors.accent, themeColors.glass]}
                    />
                    <Text style={[styles.teamNameBig, { color: headerText }]} numberOfLines={2}>{match.homeTeam}</Text>
                    <VsPill accent={themeColors.accent} accentText={themeColors.accentText} label={vsLabel} height={34} />
                    {showCountdown ? <Text style={[styles.countdownText, { color: headerText }]}>{countdown}</Text> : null}
                    <Text style={[styles.teamNameBig, { color: headerText }]} numberOfLines={2}>{match.awayTeam}</Text>
                    <TeamCrest
                        uri={match.awayTeamLogo}
                        name={match.awayTeam}
                        size={46}
                        teamColor={readableCopy(teamColors.away)}
                        fallbackColors={[themeColors.accent, themeColors.glass]}
                    />
                </View>

                {showScore && <Text style={[styles.scoreBig, { color: themeColors.accent }]}>{scoreText}</Text>}
                <Text style={[styles.statusText, { color: headerText }]}>{statusText}</Text>
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
                        isLocked={isLocked}
                        accessLoading={access.loading}
                        hasPrediction={hasPrediction}
                        pickText={pickText}
                        confidence={confidence}
                        risk={risk}
                        reasoningLines={reasoningLines}
                        sourceList={sourceList}
                        lockTier={lockTier}
                        onUnlock={() => router.push(lockTier === 'vip' ? '/(tabs)/vip' : '/(tabs)/paid')}
                    />
                ) : (
                    <OddsContent match={match} />
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewContent({
    match,
    isLocked,
    accessLoading,
    hasPrediction,
    pickText,
    confidence,
    risk,
    reasoningLines,
    sourceList,
    lockTier,
    onUnlock,
}: {
    match: MatchViewModel;
    isLocked: boolean;
    accessLoading: boolean;
    hasPrediction: boolean;
    pickText: string | undefined;
    confidence: number | undefined;
    risk: Risk;
    reasoningLines: string[];
    sourceList: { key: string; domain: string; url: string }[];
    lockTier: string;
    onUnlock: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const riskColor = (() => {
        if (risk === 'low') return themeColors.success;
        if (risk === 'medium') return themeColors.warning;
        if (risk === 'high') return themeColors.danger;
        return themeColors.mutedText;
    })();

    if (accessLoading) {
        return <SkeletonList style={{ paddingHorizontal: 16, width: '100%' }} />;
    }

    if (isLocked) {
        return <LockedPickCard lockTier={lockTier} onUnlock={onUnlock} />;
    }

    if (!hasPrediction) {
        return (
            <View style={styles.emptyState}>
                <Crown size={24} color={themeColors.accent} />
                <Text style={[styles.emptyTitle, { color: themeColors.text }]}>{textFor('matchDetail.noPredictionTitle', 'No prediction yet')}</Text>
                <Text style={[styles.emptyBody, { color: themeColors.mutedText }]}>{textFor('matchDetail.noPredictionBody', 'Check back later for AI analysis.')}</Text>
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
                riskColor={riskColor}
                suggestedBet={match.aiPrediction?.suggestedBet}
                oddValues={oddValues}
            />

            {marketTotal > 0 && (
                <View style={styles.pickCard}>
                    <SectionTitle Icon={ChartBar} title={textFor('matchDetail.marketView', 'Market view (from odds)')} />
                    <AnimatedBar value={marketTotal} height={10} radius={5} color={themeColors.accent} trackColor={themeColors.surfaceElevated} />
                    <View style={styles.marketLabels}>
                        {oddValues.map((v, i) => (
                            <Text key={i} style={[styles.marketLabel, { color: themeColors.text }]}>{v.value}</Text>
                        ))}
                    </View>
                </View>
            )}

            <ExtraFields match={match} />

            {reasoningLines.length > 0 ? (
                <View style={styles.whySection}>
                    <SectionTitle Icon={TrendingUp} title={textFor('matchDetail.whyPick', 'Why this pick')} />
                    {reasoningLines.map((line, i) => (
                        <View key={`${i}-${line.slice(0, 20)}`} style={[styles.bulletCard, { backgroundColor: themeColors.surface }]}>
                            <Text style={[styles.bulletText, { color: themeColors.text }]}>• {line}</Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {sourceList.length > 0 ? (
                <View style={styles.whySection}>
                    <SectionTitle Icon={Link2} title={textFor('matchDetail.sources', 'Sources')} />
                    <View style={styles.sourcesRow}>
                        {sourceList.map((s) => (
                            <TouchableOpacity
                                key={s.key}
                                style={[styles.sourceChip, { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border }]}
                                onPress={() => void Linking.openURL(s.url)}
                                accessibilityRole="link"
                                accessibilityLabel={`${s.domain}`}
                            >
                                <Text style={[styles.sourceChipText, { color: themeColors.mutedText }]} numberOfLines={1}>
                                    {s.domain}
                                </Text>
                                <ChevronRight size={14} color={themeColors.mutedText} />
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            ) : null}
        </View>
    );
}

function SectionTitle({ Icon, title, color }: { Icon: LucideIcon; title: string; color?: string }) {
    const { themeColors } = useTheme();
    return (
        <View style={sectionTitleStyles.row}>
            <Icon size={14} color={color ?? themeColors.accent} />
            <Text style={[sectionTitleStyles.text, { color: themeColors.text }]}>{title}</Text>
        </View>
    );
}

const sectionTitleStyles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 14 },
    text: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
});

function LockedPickCard({ lockTier, onUnlock }: { lockTier: string; onUnlock: () => void }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    return (
        <View style={styles.pickCard}>
            <View style={styles.pickHeader}>
                <Lock size={18} color={themeColors.accent} />
                <Text style={[styles.pickCardTitle, { color: themeColors.text }]}>{textFor('matchDetail.lockedTitle', 'Prediction locked')}</Text>
            </View>
            <AnimatedPulse
                style={[styles.unlockBtn, { backgroundColor: themeColors.accent }]}
                onPress={onUnlock}
                accessibilityRole="button"
            >
                <Text style={[styles.unlockBtnText, { color: themeColors.accentText }]}>
                    {lockTier === 'vip' ? textFor('matchDetail.unlockVip', 'Unlock with VIP') : textFor('matchDetail.unlockPremium', 'Unlock with Premium')}
                </Text>
            </AnimatedPulse>
        </View>
    );
}

function PickCard({
    pickText,
    confidence,
    risk,
    riskColor,
    suggestedBet,
    oddValues,
}: {
    pickText: string | undefined;
    confidence: number | undefined;
    risk: Risk;
    riskColor: string;
    suggestedBet?: string;
    oddValues: { label: string; value?: string }[];
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const listedOdds = oddValues.filter((v) => v.value !== undefined);

    return (
        <View style={[styles.pickCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
            <SectionTitle Icon={TrendingUp} title={textFor('matchDetail.pick', 'Pick')} color={themeColors.accent} />
            <Text style={[styles.pickValue, { color: themeColors.text }]} numberOfLines={3}>
                {pickText}
            </Text>
            {suggestedBet ? (
                <Text style={[styles.suggestedChipText, { color: themeColors.accent }]}>
                    {`${textFor('matchDetail.suggestedBet', 'Suggested bet')}: ${suggestedBet}`}
                </Text>
            ) : null}

            <View style={styles.confidenceWrap}>
                <Text style={[styles.fieldLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.confidence', 'Confidence')}</Text>
                <AnimatedBar value={confidence ?? 0} height={8} radius={4} color={themeColors.accent} trackColor={themeColors.surfaceElevated} />
                <Text style={[styles.pctText, { color: themeColors.text }]}>
                    {confidence !== undefined ? `${confidence}%` : '—'}
                </Text>
            </View>

            <View style={styles.riskRow}>
                <Text style={[styles.fieldLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.risk', 'Risk')}</Text>
                <View style={[styles.riskBadge, { backgroundColor: `${riskColor}22`, borderColor: `${riskColor}55` }]}>
                    <Text style={[styles.riskBadgeText, { color: riskColor }]}>{risk ? textFor(`risk.${risk}`, risk) : '—'}</Text>
                </View>
            </View>

            {listedOdds.length > 0 ? (
                <View style={styles.oddsRow}>
                    {listedOdds.map((v, i) => (
                        <Text key={i} style={[styles.oddsStaticVal, i === 0 ? { color: themeColors.accent } : { color: themeColors.text }]}>
                            {v.value}
                        </Text>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

// ---------------------------------------------------------------------------
// Extras grid
// ---------------------------------------------------------------------------

interface ExtraRow {
    key: string;
    Icon: LucideIcon;
    label: string;
    full?: boolean;
    content?: React.ReactNode;
}

function ExtraFields({ match }: { match: MatchViewModel }) {
    const { themeColors } = useTheme();
    const rows = buildExtraRows(match, themeColors);
    const styles = getStyles(themeColors);
    if (rows.length === 0) return null;

    const renderCard = (row: ExtraRow) => (
        <View key={row.key} style={[styles.extraCard, row.full ? styles.extraCardFull : styles.extraCardCol, { backgroundColor: themeColors.surface }]}>
            <SectionTitle Icon={row.Icon} title={row.label} color={themeColors.accent} />
            {row.content}
        </View>
    );

    // Two-column grid: non-full rows in pairs, full-width rows below.
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
            <Text style={styles.formBadgeText}>{char}</Text>
        </View>
    );
}

function buildExtraRows(match: MatchViewModel, themeColors: ThemeColors): ExtraRow[] {
    const rows: ExtraRow[] = [];
    const styles = getStyles(themeColors);

    if (match.potentials && match.potentials.length > 0) {
        rows.push({
            key: 'potentials',
            Icon: ChartBar,
            label: textFor('matchDetail.potentials', 'Predicted probabilities'),
            full: true,
            content: (
                <View style={styles.extraList}>
                    {match.potentials.map((p, i) => (
                        <View key={i} style={styles.extraListItem}>
                            <Text style={[styles.potentialLabel, { color: themeColors.text }]} numberOfLines={1}>{p.label}</Text>
                            <View style={[styles.potentialTrack, { backgroundColor: themeColors.surfaceElevated }]}>
                                <AnimatedBar value={p.percent ?? 0} height={8} radius={4} color={themeColors.accent} />
                            </View>
                            <Text style={[styles.pctText, { color: themeColors.text }]}>{p.percent !== undefined ? `${p.percent}%` : p.value}</Text>
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
            Icon: Flag,
            label: textFor('matchDetail.h2hSummary', 'Head to head'),
            content: (
                <View style={styles.h2hRow}>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: themeColors.accent }]}>{s.wins}</Text>
                        <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.homeWins', 'HOME WINS')}</Text>
                    </View>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: themeColors.text }]}>{s.draws}</Text>
                        <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.draws', 'DRAWS')}</Text>
                    </View>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: themeColors.text }]}>{s.losses}</Text>
                        <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.awayWins', 'AWAY WINS')}</Text>
                    </View>
                </View>
            ),
        });
    }

    if (match.homeForm) {
        rows.push({
            key: 'form-home',
            Icon: Goal,
            label: `${match.homeTeam} — ${textFor('matchDetail.form', 'Recent form')}`,
            content: <FormStreak form={match.homeForm} />,
        });
    }
    if (match.awayForm) {
        rows.push({
            key: 'form-away',
            Icon: Goal,
            label: `${match.awayTeam} — ${textFor('matchDetail.form', 'Recent form')}`,
            content: <FormStreak form={match.awayForm} />,
        });
    }

    if (match.homeXg !== undefined || match.awayXg !== undefined) {
        rows.push({
            key: 'xg',
            Icon: TrendingUp,
            label: textFor('matchDetail.xg', 'Expected goals (xG)'),
            content: (
                <View style={styles.xgRow}>
                    <Text style={[styles.xgVal, { color: themeColors.accent }]}>{(match.homeXg ?? 0).toFixed(2)}</Text>
                    <Text style={[styles.xgLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.home', 'HOME')}</Text>
                    <Text style={[styles.xgVal, { color: themeColors.text }]}>{(match.awayXg ?? 0).toFixed(2)}</Text>
                    <Text style={[styles.xgLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.away', 'AWAY')}</Text>
                </View>
            ),
        });
    }

    if (h2h?.history && h2h.history.length > 0) {
        rows.push({
            key: 'h2h-history',
            Icon: Flag,
            label: textFor('matchDetail.h2hHistory', 'H2H HISTORY'),
            full: true,
            content: (
                <View style={styles.h2hHistoryCard}>
                    {h2h.history.map((h, i) => (
                        <View key={i} style={[styles.h2hHistoryRow, i > 0 && { borderTopWidth: 1, borderTopColor: themeColors.border }]}>
                            <View style={styles.h2hHistoryLeft}>
                                <Text style={[styles.h2hHistoryLeague, { color: themeColors.mutedText }]}>{h.league}</Text>
                                <Text style={[styles.h2hHistoryTeams, { color: themeColors.text }]}>{h.home} vs {h.away}</Text>
                            </View>
                            <View style={styles.h2hHistoryRight}>
                                <Text style={[styles.h2hHistoryScore, { color: themeColors.accent }]}>{h.score}</Text>
                                <Text style={[styles.h2hHistoryDate, { color: themeColors.mutedText }]}>{h.date}</Text>
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
            Icon: Zap,
            label: textFor('matchDetail.lineups', 'Starting lineups'),
            full: true,
            content: (
                <View style={styles.lineupCols}>
                    <View style={styles.lineupCol}>
                        <Text style={[styles.lineupTeam, { color: themeColors.accent }]} numberOfLines={1}>{match.homeTeam}</Text>
                        {(match.homeLineup || []).map((p, i) => (
                            <Text key={i} style={[styles.lineupPlayer, { color: themeColors.text }]} numberOfLines={1}>
                                {p.number ? `${p.number}. ` : ''}{p.name}
                            </Text>
                        ))}
                    </View>
                    <View style={styles.lineupDivider} />
                    <View style={styles.lineupCol}>
                        <Text style={[styles.lineupTeam, { color: themeColors.text }]} numberOfLines={1}>{match.awayTeam}</Text>
                        {(match.awayLineup || []).map((p, i) => (
                            <Text key={i} style={[styles.lineupPlayer, { color: themeColors.text }]} numberOfLines={1}>
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
            Icon: ChartBar,
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
                                    <Text style={[styles.statNum, { color: themeColors.text }]}>{s.home}{s.percent ? '%' : ''}</Text>
                                    <Text style={[styles.statLabel, { color: themeColors.mutedText }]}>{s.label}</Text>
                                    <Text style={[styles.statNum, { color: themeColors.text }]}>{s.away}{s.percent ? '%' : ''}</Text>
                                </View>
                                <AnimatedBar value={homePct} height={6} radius={3} color={themeColors.accent} trackColor={themeColors.surfaceElevated} />
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
            Icon: Goal,
            label: textFor('matchDetail.cornerStats', 'Corner stats'),
            content: (
                <View style={styles.h2hRow}>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: themeColors.accent }]}>{match.homeCorners ?? 0}</Text>
                        <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>{match.homeTeam}</Text>
                    </View>
                    <View style={styles.h2hStat}>
                        <Text style={[styles.h2hVal, { color: themeColors.text }]}>{match.awayCorners ?? 0}</Text>
                        <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>{match.awayTeam}</Text>
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

// ---------------------------------------------------------------------------
// Odds tab
// ---------------------------------------------------------------------------

function OddsContent({ match }: { match: MatchViewModel }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const dOdds = match.detailedOdds;

    const values1x2 = ['home', 'draw', 'away'] as const;
    const cellValue = (val: string | undefined) => val || '—';

    return (
        <View style={styles.oddsTab}>
            {dOdds && (
                <View style={styles.oddsGrid}>
                    <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                        <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.fullTime12', 'FULL TIME 1X2')}</Text>
                        <View style={styles.oddsRow}>
                            {values1x2.map((side, i) => (
                                <View key={side} style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.text }]}>{cellValue(dOdds.ft?.['1x2']?.[side])}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>
                                        {side === 'home' ? textFor('matchDetail.home', 'HOME') : side === 'draw' ? textFor('matchDetail.draw', 'DRAW') : textFor('matchDetail.away', 'AWAY')}
                                    </Text>
                                    {i < 2 ? <View style={styles.oddsDivider} /> : null}
                                </View>
                            ))}
                        </View>
                    </View>
                    {dOdds.ft?.ou && (
                        <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                            <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.overUnder', 'GOALS OVER / UNDER')}</Text>
                            <View style={styles.oddsRow}>
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.accent }]}>{cellValue(dOdds.ft.ou.over)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>{textFor('matchDetail.over', 'OVER')} {dOdds.ft.ou.line}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.text }]}>{cellValue(dOdds.ft.ou.under)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>{textFor('matchDetail.under', 'UNDER')} {dOdds.ft.ou.line}</Text>
                                </View>
                            </View>
                        </View>
                    )}
                    {dOdds.ft?.ah && (
                        <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                            <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.asianHandicap', 'FT ASIAN HANDICAP')}</Text>
                            <View style={styles.oddsRow}>
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.accent }]}>{cellValue(dOdds.ft.ah.home)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>{textFor('matchDetail.home', 'HOME')}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.text }]}>{cellValue(dOdds.ft.ah.away)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>{textFor('matchDetail.away', 'AWAY')}</Text>
                                </View>
                            </View>
                        </View>
                    )}
                    {dOdds.ht?.['1x2'] && (
                        <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                            <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>{textFor('matchDetail.halfTime12', 'HALF TIME 1X2')}</Text>
                            <View style={styles.oddsRow}>
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.accent }]}>{cellValue(dOdds.ht['1x2'].home)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>{textFor('matchDetail.home', 'HOME')}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.text }]}>{cellValue(dOdds.ht['1x2'].draw)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>{textFor('matchDetail.draw', 'DRAW')}</Text>
                                </View>
                                <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.oddsCell}>
                                    <Text style={[styles.oddsVal, { color: themeColors.text }]}>{cellValue(dOdds.ht['1x2'].away)}</Text>
                                    <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>{textFor('matchDetail.away', 'AWAY')}</Text>
                                </View>
                            </View>
                        </View>
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
        container: { flex: 1 },
        headerBg: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 200,
            borderBottomLeftRadius: 20,
            borderBottomRightRadius: 20,
            zIndex: -1,
        },
        headerFade: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 200,
            opacity: 0.55,
            zIndex: -1,
        },
        headerAwayBlend: {
            position: 'absolute',
            top: 0,
            right: 0,
            width: 64,
            height: 200,
            borderBottomLeftRadius: 14,
            opacity: 0.4,
            zIndex: -1,
        },
        headerInner: { paddingHorizontal: 16, paddingTop: 10 },
        headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        headerLeftBtn: { padding: 6 },
        headerTitle: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, opacity: 0.9, textAlign: 'center' },
        headerRightBtn: { padding: 6, minWidth: 36, alignItems: 'flex-end' },
        teamsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
        teamNameBig: { flex: 1, fontSize: 15, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
        countdownText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
        scoreBig: { fontSize: 30, fontWeight: '800', letterSpacing: -1, textAlign: 'center' },
        statusText: { fontSize: 11, fontWeight: '600', opacity: 0.9, textAlign: 'center', marginTop: 8 },
        content: { flex: 1 },
        scrollContent: { padding: 14, paddingTop: 12, paddingBottom: 48 },
        unavailableWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
        unavailableText: { fontSize: 15, textAlign: 'center' },
        backCta: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1 },
        backCtaText: { fontSize: 15, fontWeight: '700' },

        // Overview content
        overviewContent: { gap: 14 },

        // Pick card
        pickCard: { padding: 16, borderRadius: 18, borderWidth: 1, gap: 10 },
        pickHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        pickCardTitle: { fontSize: 15, fontWeight: '700' },
        pickValue: { fontSize: 17, fontWeight: '800', lineHeight: 24 },
        suggestedChipText: { fontSize: 11, fontWeight: '600' },
        oddsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        oddsStaticVal: { fontSize: 14, fontWeight: '800', minWidth: 40 },
        confidenceWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        fieldLabel: { fontSize: 14, fontWeight: '600' },
        pctText: { fontSize: 13, fontWeight: '700', minWidth: 40, textAlign: 'right' },
        riskRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        riskBadge: { minHeight: 32, paddingHorizontal: 10, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
        riskBadgeText: { fontSize: 13, fontWeight: '700' },
        marketLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 8 },
        marketLabel: { fontSize: 12, fontWeight: '700' },
        marketView: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
        marketVals: { fontSize: 13, fontWeight: '700', minWidth: 44, textAlign: 'right' },

        // Empty state
        emptyState: { alignItems: 'center', gap: 8, paddingVertical: 40 },
        emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
        emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 18 },

        // Extras grid
        extraGrid: { gap: 10 },
        extraPair: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
        extraCol: { flex: 1 },
        extraCard: { padding: 12, borderRadius: 14, flex: 1 },
        extraCardFull: { alignItems: 'stretch' },
        extraCardCol: { alignItems: 'center' },
        extraList: { gap: 8 },
        extraListItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        potentialLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
        potentialTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
        streakRow: { flexDirection: 'row', gap: 4 },
        formBadge: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
        formBadgeText: { fontSize: 10, fontWeight: '700', color: 'white' },
        xgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: 6 },
        xgVal: { fontSize: 22, fontWeight: '800' },
        xgLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
        h2hRow: { flexDirection: 'row', justifyContent: 'space-around', gap: 6 },
        h2hStat: { alignItems: 'center', gap: 4 },
        h2hVal: { fontSize: 20, fontWeight: '800' },
        h2hLabel: { fontSize: 8, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
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

        // Why this pick
        whySection: { gap: 4 },
        bulletCard: { padding: 12, borderRadius: 12, gap: 6, borderWidth: 1 },
        bulletText: { fontSize: 13, lineHeight: 20 },

        // Sources
        sourcesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
        sourceChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, maxWidth: 130 },
        sourceChipText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.3 },

        // Locked

        // Odds tab
        oddsTab: { gap: 10 },
        oddsGrid: { gap: 10 },
        oddsTile: { padding: 16, borderRadius: 18 },
        tileLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 12 },
        oddsCell: { alignItems: 'center', flex: 1 },
        oddsDivider: { width: 1, height: 30, backgroundColor: themeColors.border },
        oddsVal: { fontSize: 15, fontWeight: '800' },
        oddsSub: { fontSize: 8, fontWeight: '600', letterSpacing: 0.5, marginTop: 2 },

        // Locked pick card
        unlockBtn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', width: '100%' },
        unlockBtnText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
    });
}
