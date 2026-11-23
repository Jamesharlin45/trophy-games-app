import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { CheckCircle2, Trophy, TrendingUp } from 'lucide-react-native';
import { useState, useCallback, useMemo } from 'react';
import { MatchSectionList } from '../../components/neon/MatchSectionList';
import { NeonPill, type NeonTone } from '../../components/neon/NeonPill';
import { onColor, readableAccent } from '../../components/neon/tokens';
import { DatePickerStrip } from '../../components/DatePickerStrip';
import { SkeletonList } from '../../components/Skeleton';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { api } from '../../api/client';
import type { ApiMatch, HistoryResponse, HistoryResult } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';
import { useMembershipAccess } from '../../hooks/useMembershipAccess';
import i18n from '../../locales';

type HistoryMatch = HistoryResponse['matches'][number];
/** Both the history route shape and the shared ApiMatch shape are rendered
 * here, so helpers accept either result vocabulary. */
type ScoredMatch = Omit<HistoryMatch, 'result'> & {
    result?: HistoryResult | NonNullable<ApiMatch['result']>;
};

const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

function getDateRange() {
    const dates: string[] = [];
    for (let i = -7; i <= 0; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

/** Pick text shown under each card (pick, then suggested bet, then the
 * AI prediction sentence). Finished matches show the real prediction for
 * every tier — never the "Unlock" preview. */
function pickText(match: ScoredMatch, access: { paid: boolean; vip: boolean }): string {
    const locked = isLockedMatch(match, access) && !isFinishedMatch(match);
    if (locked) return i18n.t('matchCard.lockedPreview');
    return match.aiPrediction?.pick ?? match.aiPrediction?.suggestedBet ?? match.aiPrediction?.prediction ?? '—';
}

function isLockedMatch(match: ScoredMatch, access: { paid: boolean; vip: boolean }): boolean {
    return (match.matchType === 'paid' && !access.paid) || (match.matchType === 'vip' && !access.vip);
}

/** History rule: finished matches show predictions for every tier; only
 * UPCOMING/LIVE matches lock. (bug: Analysis tab + match page history.) */
function isFinishedMatch(match: ScoredMatch): boolean {
    const result = match.result;
    if (result && result !== 'pending') return true;
    return match.status === 'Finished' || match.status === 'FT' || match.status === 'AET' || match.status === 'PEN';
}

function resultOf(match: HistoryMatch): HistoryResult {
    return match.result ?? 'pending';
}

/** Convert the history-route result vocabulary ('won'/'lost'/'void'/'pending')
 * to the stored one ('win'/'lose'/'void'/'pending') for the shared MatchRow,
 * which reads the match shape but not the result. */
function toStoredResult(result: HistoryResult): NonNullable<ApiMatch['result']> {
    if (result === 'won') return 'win';
    if (result === 'lost') return 'lose';
    return result;
}

function toApiMatch(match: HistoryMatch): ApiMatch {
    return { ...match, result: toStoredResult(resultOf(match)) };
}

function resultPill(result: HistoryResult | NonNullable<ApiMatch['result']>): { label: string; tone: NeonTone } {
    if (result === 'won' || result === 'win') return { label: i18n.t('wins.resultWin'), tone: 'success' };
    if (result === 'lost' || result === 'lose') return { label: i18n.t('wins.resultLoss'), tone: 'danger' };
    if (result === 'void' || result === 'draw') return { label: i18n.t('wins.resultVoid'), tone: 'neutral' };
    return { label: i18n.t('wins.resultPending'), tone: 'warning' };
}

export default function WinsScreen() {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accent = readableAccent(themeColors);
    const blue = onColor(themeColors.blue10);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedLeague, setSelectedLeague] = useState('All');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const access = useMembershipAccess();

    const {
        data: historyData,
        loading,
        refetch,
    } = useScreenQuery(() => api.matches.history(200, selectedDate), [selectedDate], { pollMs: 60000 });

    const history = historyData ?? { matches: [], strikeRate: 0, strikeRate30d: 0 };
    const matches = history.matches;

    const dates = useMemo(() => getDateRange(), []);

    // Finished matches for the selected date only.
    const dayMatches = useMemo(() => {
        return matches.filter(match => {
            const matchDate = match.matchDate || match.timestamp?.split('T')[0];
            return matchDate === selectedDate;
        });
    }, [matches, selectedDate]);

    const uniqueLeagues = useMemo(() => {
        const counts = new Map<string, number>();
        for (const m of dayMatches) counts.set(m.league, (counts.get(m.league) || 0) + 1);
        const leagues = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
        return ['All', ...leagues];
    }, [dayMatches]);

    const filteredMatches = useMemo(() => {
        return dayMatches.filter(match => selectedLeague === 'All' || match.league === selectedLeague);
    }, [dayMatches, selectedLeague]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    }, [refetch]);

    const winsCount = dayMatches.filter(m => resultOf(m) === 'won').length;
    const totalCount = dayMatches.length;
    const strikeRate = history.strikeRate ?? 0;
    const strikeRate30d = history.strikeRate30d ?? 0;

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>

            {/* Date strip */}
            <View style={[styles.calendarStrip, { borderBottomColor: themeColors.border }]}>
                <DatePickerStrip
                    dates={dates}
                    selectedDate={selectedDate}
                    onSelectDate={(date) => setSelectedDate(date)}
                    labelOverrides={{
                        [new Date().toISOString().split('T')[0]]: 'TODAY',
                    }}
                />
            </View>

            {/* League filter */}
            <View style={styles.filterSection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.leaguesScroll}>
                    {uniqueLeagues.map(league => (
                        <TouchableOpacity
                            key={league}
                            onPress={() => setSelectedLeague(league)}
                            style={[
                                styles.leagueChip,
                                {
                                    backgroundColor: selectedLeague === league
                                        ? themeColors.accent
                                        : themeColors.surfaceAlt,
                                    borderColor: selectedLeague === league ? themeColors.accent : themeColors.border,
                                },
                            ]}
                        >
                            <Text style={[
                                styles.leagueChipText,
                                { color: selectedLeague === league ? themeColors.onAccent : themeColors.textSecondary }
                            ]}>
                                {league === 'All' ? i18n.t('common.all') : toTitleCase(league)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Stats banner */}
            <View style={[styles.statsRow, { borderBottomColor: themeColors.border }]}>
                <View style={styles.statBox}>
                    <Trophy size={18} color={accent} />
                    <View>
                        <Text style={[styles.statValue, { color: themeColors.onSurface }]}>{strikeRate}%</Text>
                        <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{i18n.t('wins.strikeRate')}</Text>
                    </View>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                    <TrendingUp size={18} color={blue} />
                    <View>
                        <Text style={[styles.statValue, { color: themeColors.onSurface }]}>{strikeRate30d}%</Text>
                        <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{i18n.t('wins.strikeRate30d')}</Text>
                    </View>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                    <Text style={[styles.statValue, { color: themeColors.onSurface }]}>{winsCount}/{totalCount}</Text>
                    <Text style={[styles.statLabel, { color: themeColors.textSecondary }]}>{i18n.t('wins.winsTotal')}</Text>
                </View>
            </View>

            {loading ? (
                <SkeletonList style={styles.scrollContent} />
            ) : filteredMatches.length > 0 ? (
                <MatchSectionList
                    matches={filteredMatches.map(toApiMatch)}
                    access={{ paid: access.paid, vip: access.vip }}
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            tintColor={accent}
                            colors={[accent]}
                        />
                    }
                    ListHeaderComponent={
                        <View style={styles.sectionHeader}>
                            <CheckCircle2 size={14} color={accent} />
                            <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{i18n.t('wins.section')}</Text>
                        </View>
                    }
                    renderFooter={(match) => {
                        const pill = resultPill(match.result ?? 'pending');
                        return (
                            <View style={styles.metaRow}>
                                <View style={styles.metaContent}>
                                    <Text style={[styles.metaLabel, { color: themeColors.mutedText }]} numberOfLines={1}>
                                        {i18n.t('wins.pick')}
                                    </Text>
                                    <Text style={[styles.metaText, { color: themeColors.text }]} numberOfLines={2}>
                                        {pickText(match, access)}
                                    </Text>
                                </View>
                                <NeonPill label={pill.label} tone={pill.tone} style={styles.resultPill} />
                            </View>
                        );
                    }}
                />
            ) : (
                <ScrollView contentContainerStyle={styles.emptyContainer}>
                    <View style={[styles.emptyIconWrapper, { backgroundColor: themeColors.surfaceElevated }]}>
                        <Trophy size={36} color={themeColors.mutedText} />
                    </View>
                    <Text style={[styles.emptyText, { color: themeColors.text }]}>{i18n.t('wins.emptyTitle')}</Text>
                    <Text style={[styles.emptySubtext, { color: themeColors.mutedText }]}>
                        {i18n.t('wins.emptySub')}
                    </Text>
                </ScrollView>
            )}
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        container: { flex: 1 },
        calendarStrip: {
            borderBottomWidth: 1,
            paddingBottom: 2,
        },
        filterSection: { paddingHorizontal: 14, paddingTop: 8 },
        leaguesScroll: { paddingVertical: 4, gap: 8 },
        leagueChip: {
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 12,
            borderWidth: 1,
        },
        leagueChipText: { ...typography.chipText },
        statsRow: {
            flexDirection: 'row',
            paddingVertical: 14,
            paddingHorizontal: 20,
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottomWidth: 1,
        },
        statBox: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        statValue: { ...typography.statValue },
        statLabel: { ...typography.statLabel, color: themeColors.textSecondary },
        statDivider: { width: 1, height: 22 },
        content: { flex: 1 },
        scrollContent: { padding: 14, paddingBottom: 40 },
        sectionHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            marginTop: 6,
        },
        sectionTitle: { ...typography.sectionTitle },
        loadingContainer: { paddingVertical: 60, alignItems: 'center' },
        skeletonList: { padding: 8 },
        fixtureGrid: { gap: 8 },
        resultItem: { marginBottom: 2 },
        metaRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderTopWidth: 1,
            borderTopColor: themeColors.border,
        },
        metaContent: { flex: 1, gap: 3, minWidth: 0 },
        metaLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
        metaText: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
        resultPill: { flexShrink: 0 },
        emptyContainer: { paddingVertical: 70, alignItems: 'center', gap: 14 },
        emptyIconWrapper: {
            width: 72,
            height: 72,
            borderRadius: 36,
            alignItems: 'center',
            justifyContent: 'center',
        },
        emptyText: { ...typography.emptyText },
        emptySubtext: { ...typography.emptySubtext, textAlign: 'center', paddingHorizontal: 36 },
    });
}
