import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { Zap, Search } from 'lucide-react-native';
import { useState, useCallback, useMemo } from 'react';
import { MatchCard } from '../../components/MatchCard';
import { DatePickerStrip } from '../../components/DatePickerStrip';
import { SkeletonList } from '../../components/Skeleton';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import i18n from '../../locales';
import { api } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';
import { useNoConnectionDialog } from '../../hooks/useNoConnectionDialog';
import { useMembershipAccess } from '../../hooks/useMembershipAccess';

const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export default function FreeTipsScreen() {
    const [selectedLeague, setSelectedLeague] = useState(i18n.t('common.all'));
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const access = useMembershipAccess();
    const {
        data: matchesData,
        error,
        loading,
        refetch,
    } = useScreenQuery(
        () => api.matches.byTypeAndDate('free', selectedDate, 100),
        [selectedDate],
        { pollMs: 60000 },
    );

    const retryConnection = useCallback(async (): Promise<boolean> => {
        try {
            await api.matches.byTypeAndDate('free', selectedDate, 100);
            await refetch();
            return true;
        } catch {
            return false;
        }
    }, [selectedDate, refetch]);
    const connection = useNoConnectionDialog(error, retryConnection);

    const matches = matchesData ?? [];

    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const leagues = useMemo(() => {
        const counts = new Map<string, number>();
        for (const m of matches) counts.set(m.league, (counts.get(m.league) || 0) + 1);
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => ({ name, id: name }));
    }, [matches]);

    const filteredMatches = matches.filter((m) => {
        const leagueMatch = selectedLeague === i18n.t('common.all') || m.league === selectedLeague;
        const searchMatch =
            !searchQuery ||
            m.homeTeam.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.awayTeam.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.league.toLowerCase().includes(searchQuery.toLowerCase());
        return leagueMatch && searchMatch;
    });

    const onRefresh = useCallback(async () => {
        connection.arm();
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    }, [connection, refetch]);

    const dates = useMemo(() => {
        const d: string[] = [];
        for (let i = -3; i <= 3; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            d.push(date.toISOString().split('T')[0]);
        }
        return d;
    }, []);

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <View style={[styles.subHeader, { backgroundColor: themeColors.background, borderBottomColor: themeColors.border }]}>
                <View style={styles.filterSection}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.leagueFilterContent}
                    >
                        <TouchableOpacity
                            activeOpacity={0.75}
                            style={[
                                styles.leagueChip,
                                { borderColor: themeColors.border },
                                selectedLeague === i18n.t('common.all') && {
                                    backgroundColor: themeColors.accent,
                                    borderColor: themeColors.accent,
                                    shadowColor: themeColors.accent,
                                    ...styles.leagueChipActiveShadow,
                                },
                            ]}
                            onPress={() => setSelectedLeague(i18n.t('common.all'))}
                        >
                            <Text style={[styles.leagueChipText, selectedLeague === i18n.t('common.all') ? { color: themeColors.accentText } : { color: themeColors.mutedText }]}>
                                {i18n.t('common.all')}
                            </Text>
                        </TouchableOpacity>
                        {leagues.map((league) => (
                            <TouchableOpacity
                                key={league.id}
                                activeOpacity={0.75}
                                style={[
                                    styles.leagueChip,
                                    { borderColor: themeColors.border },
                                    selectedLeague === league.name && {
                                        backgroundColor: themeColors.accent,
                                        borderColor: themeColors.accent,
                                        shadowColor: themeColors.accent,
                                        ...styles.leagueChipActiveShadow,
                                    },
                                ]}
                                onPress={() => setSelectedLeague(league.name)}
                            >
                                <Text style={[styles.leagueChipText, selectedLeague === league.name ? { color: themeColors.accentText } : { color: themeColors.mutedText }]}>
                                    {toTitleCase(league.name)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                <View style={styles.searchSection}>
                    <View style={[styles.searchBar, { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border }]}>
                        <Search size={18} color={themeColors.mutedText} />
                        <TextInput
                            style={[styles.searchInput, { color: themeColors.text }]}
                            placeholder={i18n.t('home.searchPlaceholder')}
                            placeholderTextColor={themeColors.mutedText}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                    </View>
                </View>

                <View style={styles.dateStripWrapper}>
                    <DatePickerStrip
                        dates={dates}
                        selectedDate={selectedDate}
                        onSelectDate={(date) => setSelectedDate(date)}
                    />
                </View>
            </View>

            <ScrollView
                style={styles.fixtureList}
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
                {loading ? (
                    <SkeletonList />
                ) : filteredMatches.length > 0 ? (
                    <View style={styles.fixtureGrid}>
                        {filteredMatches.map((match, idx) => (
                            <MatchCard
                                key={match.id}
                                match={match}
                                access={{ paid: access.paid, vip: access.vip }}
                                index={idx}
                            />
                        ))}
                    </View>
                ) : (
                    <View style={styles.emptyContainer}>
                        <View
                            style={[
                                styles.emptyIconWrapper,
                                { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border },
                            ]}
                        >
                            <Zap size={36} color={themeColors.accent} />
                        </View>
                        <View style={styles.emptyTextGroup}>
                            <Text style={[styles.emptyTitle, { color: themeColors.text }]}>{i18n.t('home.noMatches')}</Text>
                            <Text style={[styles.emptySubtitle, { color: themeColors.mutedText }]}>
                                {i18n.t('home.noResultsSub')}
                            </Text>
                        </View>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
    container: {
        flex: 1,
    },
    subHeader: {
        paddingTop: 16,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 14,
    },
    filterSection: {
        marginBottom: 0,
    },
    leagueFilterContent: {
        paddingHorizontal: 20,
        gap: 8,
        alignItems: 'center',
    },
    leagueChip: {
        paddingHorizontal: 18,
        paddingVertical: 9,
        borderRadius: 22,
        backgroundColor: themeColors.glass,
        borderWidth: 1,
    },
    leagueChipActiveShadow: {
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
    },
    leagueChipText: {
        ...typography.chipText,
        letterSpacing: 0.2,
    },
    searchSection: {
        paddingHorizontal: 20,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        gap: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        fontWeight: '500',
        padding: 0,
    },
    dateStripWrapper: {
        // No extra paddingHorizontal — the strip manages its own padding
    },
    fixtureList: {
        flex: 1,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 48,
    },
    loadingContainer: {
        paddingVertical: 8,
        alignItems: 'center',
        gap: 12,
    },
    fixtureGrid: {
        gap: 12,
    },
    emptyContainer: {
        paddingVertical: 88,
        alignItems: 'center',
        gap: 20,
    },
    emptyIconWrapper: {
        width: 84,
        height: 84,
        borderRadius: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    emptyTextGroup: {
        alignItems: 'center',
        gap: 8,
    },
    emptyTitle: {
        ...typography.emptyTitle,
        letterSpacing: 0.3,
    },
    emptySubtitle: {
        ...typography.emptySubtitle,
        textAlign: 'center',
        paddingHorizontal: 32,
        lineHeight: 20,
    },
    });
}
