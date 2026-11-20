import { View, Text, ScrollView, ActivityIndicator, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { CheckCircle2, Trophy, TrendingUp } from 'lucide-react-native';
import { useState, useCallback, useMemo } from 'react';
import { MatchCard } from '../../components/MatchCard';
import { DatePickerStrip } from '../../components/DatePickerStrip';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { api } from '../../api/client';
import type { ApiMatch } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';

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

export default function WinsScreen() {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedLeague, setSelectedLeague] = useState('All');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);

    const {
        data: historyData,
        loading,
        refetch,
    } = useScreenQuery(() => api.matches.history(200), [], { pollMs: 60000 });

    const matches = historyData ?? [];

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

    // "Win" = home side won (final score), matching the web History strike rate.
    const isWin = (m: ApiMatch) => m.homeScore !== undefined && m.awayScore !== undefined && m.homeScore > m.awayScore;
    const winCount = dayMatches.filter(isWin).length;
    const winRate = dayMatches.length > 0 ? Math.round((winCount / dayMatches.length) * 100) : 0;

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>

            {/* Date strip */}
            <View style={[styles.calendarStrip, { borderBottomColor: themeColors.border }]}>
                <DatePickerStrip
                    dates={dates}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
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
                                { backgroundColor: selectedLeague === league ? themeColors.accent : themeColors.surfaceElevated }
                            ]}
                        >
                            <Text style={[
                                styles.leagueChipText,
                                { color: selectedLeague === league ? 'white' : themeColors.mutedText }
                            ]}>
                                {league === 'All' ? 'All' : toTitleCase(league)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Stats banner */}
            <View style={[styles.statsRow, { borderBottomColor: themeColors.border }]}>
                <View style={styles.statBox}>
                    <Trophy size={18} color={themeColors.accent} />
                    <View>
                        <Text style={[styles.statValue, { color: themeColors.text }]}>{winRate}%</Text>
                        <Text style={[styles.statLabel, { color: themeColors.mutedText }]}>STRIKE RATE</Text>
                    </View>
                </View>
                <View style={[styles.statDivider, { backgroundColor: themeColors.border }]} />
                <View style={styles.statBox}>
                    <TrendingUp size={18} color={themeColors.blue10} />
                    <View>
                        <Text style={[styles.statValue, { color: themeColors.text }]}>{winCount}/{dayMatches.length}</Text>
                        <Text style={[styles.statLabel, { color: themeColors.mutedText }]}>WINS / TOTAL</Text>
                    </View>
                </View>
            </View>

            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={themeColors.accent}
                        colors={[themeColors.accent]}
                    />
                }
            >
                <View style={styles.sectionHeader}>
                    <CheckCircle2 size={14} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.text }]}>PROVEN RESULTS</Text>
                </View>

                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={themeColors.accent} />
                    </View>
                ) : filteredMatches.length > 0 ? (
                    <View style={styles.fixtureGrid}>
                        {filteredMatches.map((match) => (
                            <MatchCard
                                key={match._id || match.id}
                                matchId={match.id}
                                matchData={match}
                                leagueName={match.league}
                                leagueLogo={match.leagueLogo}
                                time="FT"
                                homeTeam={match.homeTeam}
                                homeTeamLogo={match.homeTeamLogo}
                                awayTeam={match.awayTeam}
                                awayTeamLogo={match.awayTeamLogo}
                                prediction={match.result ? match.result.toUpperCase() : (match.aiPrediction?.prediction || 'FT')}
                                odds={match.odds?.home || '—'}
                                homeScore={match.homeScore}
                                awayScore={match.awayScore}
                                aiInsight={match.aiPrediction}
                            />
                        ))}
                    </View>
                ) : (
                    <View style={styles.emptyContainer}>
                        <View style={[styles.emptyIconWrapper, { backgroundColor: themeColors.surfaceElevated }]}>
                            <Trophy size={36} color={themeColors.mutedText} />
                        </View>
                        <Text style={[styles.emptyText, { color: themeColors.text }]}>No Results Yet</Text>
                        <Text style={[styles.emptySubtext, { color: themeColors.mutedText }]}>
                            No finished matches for this date.
                        </Text>
                    </View>
                )}
            </ScrollView>
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
        borderColor: themeColors.border,
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
    statLabel: { ...typography.statLabel },
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
    fixtureGrid: { gap: 8 },
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
