import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ChevronLeft, Zap, ShieldCheck, Goal } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { getCountryFlagUrl } from '../../lib/flags';
import { fetchMatchStats } from '../../api/footystats';
import type { MatchDetailData } from '../../api/footystats';
import { api } from '../../api/client';
import type { ApiMatch } from '../../api/client';

type MatchViewModel = Omit<
    ApiMatch,
    'h2h' | 'detailedOdds' | 'homeLineup' | 'awayLineup' | 'goals' | 'stats' | 'potentials' | 'oddsComparison'
> &
    Partial<MatchDetailData>;


const TeamLogo = ({ uri, name, textColor }: { uri?: string; name: string; textColor: string }) => {
    const [failed, setFailed] = useState(false);
    const { themeColors } = useTheme();
    const logoStyles = getLogoStyles(themeColors);
    const initials = name.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
    const flagUri = !uri || failed ? getCountryFlagUrl(name) : undefined;

    if (flagUri) {
        return (
            <View style={logoStyles.flagBox}>
                <Image source={{ uri: flagUri }} style={logoStyles.flag} />
            </View>
        );
    }
    if (uri && !failed) {
        return <Image source={{ uri }} style={logoStyles.img} onError={() => setFailed(true)} />;
    }
    return <Text style={[logoStyles.initials, { color: textColor }]}>{initials}</Text>;
};

function getLogoStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
    img: { width: 46, height: 46, resizeMode: 'contain' },
    flagBox: { width: 46, height: 46, borderRadius: 12, overflow: 'hidden', backgroundColor: themeColors.glass, alignItems: 'center', justifyContent: 'center' },
    flag: { width: 46, height: 30, resizeMode: 'cover' },
    initials: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
    });
}

export default function MatchDetailScreen() {
    const { id, matchData } = useLocalSearchParams();
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const [match, setMatch] = useState<MatchViewModel | null>(null);
    const [loading, setLoading] = useState(true);

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
                        Object.entries(remoteMatch).filter(([, v]) => v !== undefined && v !== '')
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

            // 3. Fetch the rich match-stats from the API (same source as web) —
            //    form, H2H, corners, xG, potentials, stats, lineups, detailed odds.
            try {
                const stats = await fetchMatchStats(id as string);
                if (stats && !cancelled) {
                    const richPatch = Object.fromEntries(
                        Object.entries(stats).filter(([, v]) =>
                            v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
                        )
                    ) as Partial<MatchViewModel>;
                    setMatch({
                        ...(merged ?? {}),
                        ...richPatch,
                        // List/API stay authoritative for these basics.
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

    if (loading && !match) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center', alignItems: 'center' }]} edges={['left', 'right']}>
                <ActivityIndicator size="large" color={themeColors.accent} />
            </SafeAreaView>
        );
    }

    if (!match) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center', alignItems: 'center' }]} edges={['left', 'right']}>
                <Text style={{ color: themeColors.mutedText }}>Match details unavailable</Text>
                <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
                    <Text style={{ color: themeColors.accent, fontWeight: '700' }}>GO BACK</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const isLive = match.status?.includes('Live') || match.status === 'Halftime';
    const isFinished = match.status === 'Finished' || match.status === 'FT';

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background }]} edges={['left', 'right']}>
            {/* Custom Header */}
            <View style={[styles.customHeader, { backgroundColor: themeColors.background }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.headerLeft}>
                    <ChevronLeft size={24} color={themeColors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: themeColors.text }]}>
                    {match.league ? match.league.replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : 'Match Details'}
                </Text>
                <View style={styles.headerRight} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

                {/* Hero Scoreboard */}
                <View style={[styles.scoreboard, { backgroundColor: themeColors.surfaceElevated }]}>
                    <View style={styles.leagueRow}>
                        <ShieldCheck size={11} color={themeColors.mutedText} />
                        <Text style={[styles.leagueText, { color: themeColors.mutedText }]}>
                            {match.league?.replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())}
                        </Text>
                        {match.country && (
                            <Text style={[styles.countryText, { color: themeColors.mutedText }]}>• {match.country}</Text>
                        )}
                    </View>

                    {/* Status Badge */}
                    <View style={[
                        styles.statusBadge,
                        {
                            backgroundColor: isLive ? themeColors.danger : isFinished ? themeColors.surface : themeColors.surface,
                        }
                    ]}>
                        {isLive && <View style={styles.liveDot} />}
                        <Text style={[
                            styles.statusText,
                            { color: isLive ? 'white' : themeColors.mutedText }
                        ]}>
                            {isLive ? match.status?.toUpperCase() : isFinished ? 'FULL TIME' : 'UPCOMING'}
                        </Text>
                    </View>

                    {/* Teams + Score */}
                    <View style={styles.teamsRow}>
                        <View style={styles.teamCol}>
                            <View style={[styles.logoBox, { backgroundColor: themeColors.surface }]}>
                                <TeamLogo uri={match.homeTeamLogo} name={match.homeTeam} textColor={themeColors.mutedText} />
                            </View>
                            <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={2}>{match.homeTeam}</Text>
                            {match.homeStanding && (
                                <Text style={[styles.standingText, { color: themeColors.mutedText }]}>#{match.homeStanding}</Text>
                            )}
                        </View>

                        <View style={styles.scoreCol}>
                            {(match.homeScore !== undefined) ? (
                                <Text style={[styles.scoreText, { color: themeColors.accent }]}>
                                    {match.homeScore} — {match.awayScore}
                                </Text>
                            ) : (
                                <Text style={[styles.vsText, { color: themeColors.text }]}>VS</Text>
                            )}
                            <Text style={[styles.kickoffText, { color: themeColors.mutedText }]}>
                                {new Date(match.timestamp).toLocaleString([], {
                                    weekday: 'short', month: 'short', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit'
                                })}
                            </Text>
                            {(match.htHomeScore !== undefined && match.htAwayScore !== undefined) && (
                                <Text style={[styles.htText, { color: themeColors.mutedText }]}>
                                    HT {match.htHomeScore} - {match.htAwayScore}
                                </Text>
                            )}
                            {match.isTrending && (
                                <View style={[styles.hotBadge, { backgroundColor: themeColors.orange9 }]}>
                                    <Zap size={9} color="white" fill="white" />
                                    <Text style={styles.hotText}>HOT</Text>
                                </View>
                            )}
                        </View>

                        <View style={styles.teamCol}>
                            <View style={[styles.logoBox, { backgroundColor: themeColors.surface }]}>
                                <TeamLogo uri={match.awayTeamLogo} name={match.awayTeam} textColor={themeColors.mutedText} />
                            </View>
                            <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={2}>{match.awayTeam}</Text>
                            {match.awayStanding && (
                                <Text style={[styles.standingText, { color: themeColors.mutedText }]}>#{match.awayStanding}</Text>
                            )}
                        </View>
                    </View>
                </View>

                {/* Match Predictions (pre-match probability potentials) */}
                {match.potentials && match.potentials.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>MATCH PREDICTIONS</Text>
                        <View style={[styles.potentialCard, { backgroundColor: themeColors.surface }]}>
                            {match.potentials.map((p, i: number) => (
                                <View key={i} style={styles.potentialRow}>
                                    <Text style={[styles.potentialLabel, { color: themeColors.text }]}>{p.label}</Text>
                                    {p.percent !== undefined ? (
                                        <View style={styles.potentialBarWrap}>
                                            <View style={[styles.potentialBarTrack, { backgroundColor: themeColors.surfaceElevated }]}>
                                                <View style={[styles.potentialBarFill, { width: `${p.percent}%`, backgroundColor: themeColors.accent }]} />
                                            </View>
                                            <Text style={[styles.potentialPct, { color: themeColors.accent }]}>{p.percent}%</Text>
                                        </View>
                                    ) : (
                                        <Text style={[styles.potentialPct, { color: themeColors.accent }]}>{p.value}</Text>
                                    )}
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Market Odds - Show detailedOdds if available, otherwise fall back to basic odds */}
                {(match.detailedOdds || match.odds) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>MARKET ODDS</Text>
                        <View style={styles.oddsGrid}>
                            <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                                <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>FULL TIME 1X2</Text>
                                <View style={styles.oddsRow}>
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.accent }]}>
                                            {match.detailedOdds?.ft?.['1x2']?.home || match.odds?.home || '—'}
                                        </Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>HOME</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>
                                            {match.detailedOdds?.ft?.['1x2']?.draw || match.odds?.draw || '—'}
                                        </Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>DRAW</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>
                                            {match.detailedOdds?.ft?.['1x2']?.away || match.odds?.away || '—'}
                                        </Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>AWAY</Text>
                                    </View>
                                </View>
                            </View>

                            {match.detailedOdds?.ft?.['ou'] && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>GOALS OVER / UNDER</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft['ou'].over || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>OVER {match.detailedOdds.ft['ou'].line}</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft['ou'].under || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>UNDER {match.detailedOdds.ft['ou'].line}</Text>
                                        </View>
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                )}

                {/* Detailed Odds */}
                {match.detailedOdds && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>DETAILED ODDS</Text>
                        <View style={styles.oddsGrid}>
                            {/* FT 1X2 */}
                            <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                                <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>FULL TIME 1X2</Text>
                                <View style={styles.oddsRow}>
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.accent }]}>{match.detailedOdds.ft?.['1x2'].home || '—'}</Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>HOME</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft?.['1x2'].draw || '—'}</Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>DRAW</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft?.['1x2'].away || '—'}</Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>AWAY</Text>
                                    </View>
                                </View>
                            </View>

                            {/* FT O/U */}
                            {match.detailedOdds.ft?.ou && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>FT OVER / UNDER ({match.detailedOdds.ft.ou.line})</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ou.over}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>OVER</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ou.under}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>UNDER</Text>
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* FT AH */}
                            {match.detailedOdds.ft?.ah && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>FT ASIAN HANDICAP ({match.detailedOdds.ft.ah.line})</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ah.home}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>HOME</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ah.away}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>AWAY</Text>
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* HT 1X2 */}
                            {match.detailedOdds.ht?.['1x2'] && (match.detailedOdds.ht['1x2'].home || match.detailedOdds.ht['1x2'].draw || match.detailedOdds.ht['1x2'].away) && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>HALF TIME 1X2</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.accent }]}>{match.detailedOdds.ht['1x2'].home || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>HOME</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ht['1x2'].draw || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>DRAW</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ht['1x2'].away || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.mutedText }]}>AWAY</Text>
                                        </View>
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                )}

                {/* Bookmaker Odds Comparison */}
                {match.oddsComparison && match.oddsComparison.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>ODDS COMPARISON</Text>
                        <View style={styles.oddsGrid}>
                            {match.oddsComparison.map((m, i: number) => (
                                <View key={i} style={[styles.oddsTile, { backgroundColor: themeColors.surface }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.mutedText }]}>{m.market.toUpperCase()}</Text>
                                    {m.selections.map((sel, j: number) => {
                                        const vals = sel.odds.map((o) => parseFloat(o.value)).filter((n: number) => !isNaN(n));
                                        const best = vals.length ? Math.max(...vals) : null;
                                        return (
                                            <View key={j} style={styles.ocRow}>
                                                <Text style={[styles.ocSelection, { color: themeColors.text }]} numberOfLines={2}>{sel.name}</Text>
                                                <ScrollView
                                                    horizontal
                                                    showsHorizontalScrollIndicator={false}
                                                    style={styles.ocScrollWrap}
                                                    contentContainerStyle={styles.ocScroll}
                                                >
                                                    {sel.odds.map((o, k: number) => {
                                                        const isBest = best !== null && parseFloat(o.value) === best;
                                                        return (
                                                            <View
                                                                key={k}
                                                                style={[
                                                                    styles.ocChip,
                                                                    { backgroundColor: themeColors.surfaceElevated, borderColor: 'transparent' },
                                                                    isBest && { backgroundColor: `${themeColors.accent}1A`, borderColor: themeColors.accent },
                                                                ]}
                                                            >
                                                                <Text style={[styles.ocBookie, { color: themeColors.mutedText }]} numberOfLines={1}>{o.bookie}</Text>
                                                                <Text style={[styles.ocValue, { color: isBest ? themeColors.accent : themeColors.text }]}>{o.value}</Text>
                                                            </View>
                                                        );
                                                    })}
                                                </ScrollView>
                                            </View>
                                        );
                                    })}
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* H2H Summary */}
                {match.h2h?.summary && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>HEAD TO HEAD</Text>
                        <View style={[styles.h2hCard, { backgroundColor: themeColors.surface }]}>
                            <View style={styles.h2hRow}>
                                <View style={styles.h2hStat}>
                                    <Text style={[styles.h2hVal, { color: themeColors.accent }]}>{match.h2h.summary.wins}</Text>
                                    <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>HOME WINS</Text>
                                </View>
                                <View style={styles.h2hStat}>
                                    <Text style={[styles.h2hVal, { color: themeColors.text }]}>{match.h2h.summary.draws}</Text>
                                    <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>DRAWS</Text>
                                </View>
                                <View style={styles.h2hStat}>
                                    <Text style={[styles.h2hVal, { color: themeColors.text }]}>{match.h2h.summary.losses}</Text>
                                    <Text style={[styles.h2hLabel, { color: themeColors.mutedText }]}>AWAY WINS</Text>
                                </View>
                            </View>
                            {/* Visual bar */}
                            <View style={styles.h2hBar}>
                                <View style={[styles.h2hBarSegment, {
                                    backgroundColor: themeColors.accent,
                                    flex: match.h2h.summary.wins || 1,
                                }]} />
                                <View style={[styles.h2hBarSegment, {
                                    backgroundColor: themeColors.border,
                                    flex: match.h2h.summary.draws || 1,
                                }]} />
                                <View style={[styles.h2hBarSegment, {
                                    backgroundColor: themeColors.mutedText,
                                    flex: match.h2h.summary.losses || 1,
                                }]} />
                            </View>
                        </View>
                    </View>
                )}

                {/* H2H History */}
                {match.h2h?.history && match.h2h.history.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>H2H HISTORY</Text>
                        <View style={[styles.h2hHistoryCard, { backgroundColor: themeColors.surface }]}>
                            {match.h2h.history.map((h, i: number) => (
                                <View key={i} style={[styles.h2hHistoryRow, i < match.h2h!.history!.length - 1 && { borderBottomWidth: 1, borderBottomColor: themeColors.border }]}>
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
                    </View>
                )}

                {/* Team Form */}
                {(match.homeForm || match.awayForm) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>RECENT FORM</Text>
                        <View style={[styles.formCard, { backgroundColor: themeColors.surface }]}>
                            {match.homeForm && (
                                <View style={styles.formRow}>
                                    <Text style={[styles.formTeam, { color: themeColors.text }]}>{match.homeTeam}</Text>
                                    <View style={styles.formStreak}>
                                        {match.homeForm.split('').slice(0, 5).map((char: string, i: number) => (
                                            <View key={i} style={[styles.formBadge, {
                                                backgroundColor: char === 'W' ? themeColors.success : char === 'D' ? themeColors.orange9 : themeColors.danger
                                            }]}>
                                                <Text style={styles.formBadgeText}>{char}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )}
                            {match.awayForm && (
                                <View style={[styles.formRow, match.homeForm && { borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 12, marginTop: 12 }]}>
                                    <Text style={[styles.formTeam, { color: themeColors.text }]}>{match.awayTeam}</Text>
                                    <View style={styles.formStreak}>
                                        {match.awayForm.split('').slice(0, 5).map((char: string, i: number) => (
                                            <View key={i} style={[styles.formBadge, {
                                                backgroundColor: char === 'W' ? themeColors.success : char === 'D' ? themeColors.orange9 : themeColors.danger
                                            }]}>
                                                <Text style={styles.formBadgeText}>{char}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                )}

                {/* Lineups */}
                {((match.homeLineup?.length ?? 0) > 0 || (match.awayLineup?.length ?? 0) > 0) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>STARTING LINEUPS</Text>
                        <View style={[styles.lineupCard, { backgroundColor: themeColors.surface }]}>
                            <View style={styles.lineupCols}>
                                <View style={styles.lineupCol}>
                                    <Text style={[styles.lineupTeam, { color: themeColors.accent }]} numberOfLines={1}>{match.homeTeam}</Text>
                                    {(match.homeLineup || []).map((p, i: number) => (
                                        <Text key={i} style={[styles.lineupPlayer, { color: themeColors.text }]} numberOfLines={1}>
                                            {p.number ? `${p.number}. ` : ''}{p.name}
                                        </Text>
                                    ))}
                                </View>
                                <View style={[styles.lineupDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.lineupCol}>
                                    <Text style={[styles.lineupTeam, { color: themeColors.text }]} numberOfLines={1}>{match.awayTeam}</Text>
                                    {(match.awayLineup || []).map((p, i: number) => (
                                        <Text key={i} style={[styles.lineupPlayer, { color: themeColors.text }]} numberOfLines={1}>
                                            {p.number ? `${p.number}. ` : ''}{p.name}
                                        </Text>
                                    ))}
                                </View>
                            </View>
                        </View>
                    </View>
                )}

                {/* Expected Goals (xG) */}
                {(match.homeXg !== undefined || match.awayXg !== undefined) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>EXPECTED GOALS (xG)</Text>
                        <View style={[styles.xgCard, { backgroundColor: themeColors.surface }]}>
                            <Text style={[styles.xgVal, { color: themeColors.accent }]}>{(match.homeXg ?? 0).toFixed(2)}</Text>
                            <Text style={[styles.xgLabel, { color: themeColors.mutedText }]}>xG</Text>
                            <Text style={[styles.xgVal, { color: themeColors.text }]}>{(match.awayXg ?? 0).toFixed(2)}</Text>
                        </View>
                    </View>
                )}

                {/* Match Stats (possession, shots, etc.) */}
                {match.stats && match.stats.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>MATCH STATS</Text>
                        <View style={[styles.statsCard, { backgroundColor: themeColors.surface }]}>
                            {match.stats.map((s, i: number) => {
                                const total = (s.home + s.away) || 1;
                                const homePct = Math.round((s.home / total) * 100);
                                return (
                                    <View key={i} style={styles.statBlock}>
                                        <View style={styles.statValues}>
                                            <Text style={[styles.statNum, { color: themeColors.text }]}>{s.home}{s.percent ? '%' : ''}</Text>
                                            <Text style={[styles.statLabel, { color: themeColors.mutedText }]}>{s.label}</Text>
                                            <Text style={[styles.statNum, { color: themeColors.text }]}>{s.away}{s.percent ? '%' : ''}</Text>
                                        </View>
                                        <View style={[styles.statBarTrack, { backgroundColor: themeColors.surfaceElevated }]}>
                                            <View style={[styles.statBarFill, { width: `${homePct}%`, backgroundColor: themeColors.accent }]} />
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                )}

                {/* Goal Timeline */}
                {match.goals && match.goals.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>GOALS</Text>
                        <View style={[styles.timelineCard, { backgroundColor: themeColors.surface }]}>
                            {match.goals.map((g, i: number) => (
                                <View key={i} style={[styles.goalRow, g.team === 'away' && styles.goalRowAway]}>
                                    <Goal size={14} color={themeColors.accent} />
                                    <View style={[styles.goalInfo, g.team === 'away' && { alignItems: 'flex-end' }]}>
                                        <Text style={[styles.goalScorer, { color: themeColors.text }]}>{g.scorer} {g.time}'</Text>
                                        {g.assist && (
                                            <Text style={[styles.goalAssist, { color: themeColors.mutedText }]}>assist: {g.assist}</Text>
                                        )}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Corner Stats */}
                {(match.homeCorners !== undefined || match.awayCorners !== undefined) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>CORNER STATS</Text>
                        <View style={[styles.infoCard, { backgroundColor: themeColors.surface }]}>
                            <View style={styles.infoRow}>
                                <Text style={[styles.infoKey, { color: themeColors.mutedText }]}>{match.homeTeam}</Text>
                                <Text style={[styles.infoVal, { color: themeColors.text }]}>{match.homeCorners ?? 0}</Text>
                            </View>
                            <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 12 }]}>
                                <Text style={[styles.infoKey, { color: themeColors.mutedText }]}>{match.awayTeam}</Text>
                                <Text style={[styles.infoVal, { color: themeColors.text }]}>{match.awayCorners ?? 0}</Text>
                            </View>
                        </View>
                    </View>
                )}

                {/* Match Info */}
                {(match.stadium || match.attendance || (match.tvStations?.length ?? 0) > 0 || match.referee || match.weather) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.mutedText }]}>MATCH INFO</Text>
                        <View style={[styles.infoCard, { backgroundColor: themeColors.surface }]}>
                            {match.stadium && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.mutedText }]}>VENUE</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]} numberOfLines={1}>{match.stadium}</Text>
                                </View>
                            )}
                            {match.attendance && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.mutedText }]}>ATTENDANCE</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]}>{match.attendance.toLocaleString()}</Text>
                                </View>
                            )}
                            {match.tvStations && match.tvStations.length > 0 && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.mutedText }]}>TV</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]} numberOfLines={1}>{match.tvStations.join(', ')}</Text>
                                </View>
                            )}
                            {match.referee && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.mutedText }]}>REFEREE</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]}>{match.referee}</Text>
                                </View>
                            )}
                            {match.weather && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.mutedText }]}>WEATHER</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]}>{match.weather}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                )}

            </ScrollView>
        </SafeAreaView>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
    container: { flex: 1 },
    scrollContent: { paddingBottom: 48 },

    // Scoreboard
    scoreboard: {
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 32,
        alignItems: 'center',
        gap: 12,
    },
    leagueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    leagueText: {
        ...typography.leagueNameDetail,
    },
    countryText: {
        fontSize: 10,
        fontWeight: '600',
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 20,
    },
    liveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'white',
    },
    statusText: {
        ...typography.statusDetail,
    },
    teamsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        marginTop: 4,
    },
    teamCol: {
        flex: 1,
        alignItems: 'center',
        gap: 10,
    },
    logoBox: {
        width: 72,
        height: 72,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: themeColors.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 6,
    },
    teamLogo: {
        width: 46,
        height: 46,
        resizeMode: 'contain',
    },
    teamName: {
        ...typography.teamNameDetail,
    },
    standingText: {
        ...typography.standing,
    },
    scoreCol: {
        alignItems: 'center',
        paddingHorizontal: 8,
        gap: 6,
    },
    scoreText: {
        ...typography.scoreTextDetail,
    },
    vsText: {
        ...typography.vsText,
    },
    kickoffText: {
        ...typography.timeDetail,
    },
    hotBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
    },
    hotText: {
        ...typography.hotBadge,
    },

    // Section card
    section: {
        margin: 16,
        marginTop: 8,
        padding: 18,
        borderRadius: 22,
        borderWidth: 1,
        shadowColor: themeColors.shadow,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        elevation: 6,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    sectionTitle: {
        ...typography.aiSectionTitle,
    },

    // AI body
    aiBody: { gap: 16 },
    predictionCard: {
        padding: 16,
        borderRadius: 16,
        gap: 8,
    },
    probRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    probLabel: { ...typography.aiProbLabel },
    probValue: { ...typography.aiProbValue },
    mainPick: { ...typography.aiMainPick },
    suggestedBet: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        borderWidth: 1,
        marginTop: 4,
    },
    suggestedBetText: { ...typography.aiSuggestedBet },
    subLabel: { ...typography.subLabel, marginBottom: 8 },
    reasoningContainer: { gap: 10 },
    reasonRow: {
        flexDirection: 'row',
        gap: 10,
        alignItems: 'flex-start',
    },
    reasonText: {
        ...typography.aiReasoning,
    },
    emptyBox: {
        padding: 28,
        borderRadius: 16,
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    emptyText: { ...typography.emptyBoxText },

    // Outer padding wrapper
    outerPad: { paddingHorizontal: 16, paddingBottom: 4 },
    sectionLabel: {
        ...typography.sectionLabel,
        marginBottom: 12,
        opacity: 0.7,
    },

    // Odds
    oddsGrid: { gap: 10 },
    oddsTile: { padding: 16, borderRadius: 18 },
    tileLabel: { ...typography.tileLabel, marginBottom: 14 },
    oddsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
    oddsCell: { alignItems: 'center', flex: 1 },
    oddsDivider: { width: 1, height: 30 },
    oddsVal: { ...typography.oddsVal },
    oddsSub: { ...typography.oddsSub },

    // H2H
    h2hCard: { padding: 16, borderRadius: 18, gap: 14 },
    h2hRow: { flexDirection: 'row', justifyContent: 'space-around' },
    h2hStat: { alignItems: 'center', gap: 4 },
    h2hVal: { ...typography.h2hValue },
    h2hLabel: { ...typography.h2hLabel },
    h2hBar: {
        flexDirection: 'row',
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        gap: 2,
    },
    h2hBarSegment: { borderRadius: 3 },

    // Info
    infoCard: { padding: 16, borderRadius: 18, gap: 12 },
    infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    infoKey: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
    infoVal: { fontSize: 13, fontWeight: '500' },

    // H2H History
    h2hHistoryCard: { padding: 16, borderRadius: 18, gap: 0 },
    h2hHistoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
    h2hHistoryLeft: { flex: 1 },
    h2hHistoryLeague: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
    h2hHistoryTeams: { fontSize: 12, fontWeight: '600' },
    h2hHistoryRight: { alignItems: 'flex-end' },
    h2hHistoryScore: { fontSize: 14, fontWeight: '700' },
    h2hHistoryDate: { fontSize: 9, fontWeight: '500', marginTop: 2 },

    // Form
    formCard: { padding: 16, borderRadius: 18, gap: 12 },
    formRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    formTeam: { fontSize: 13, fontWeight: '600', flex: 1 },
    formStreak: { flexDirection: 'row', gap: 4 },
    formBadge: { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    formBadgeText: { fontSize: 10, fontWeight: '700', color: 'white' },

    // Custom Header
    customHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: themeColors.border,
    },
    headerLeft: {
        padding: 8,
        marginLeft: -8,
    },
    headerTitle: {
        ...typography.headerTitle,
    },
    headerRight: {
        width: 40,
    },

    // HT score
    htText: { fontSize: 10, fontWeight: '600', marginTop: 2 },

    // GPT preview
    previewText: { fontSize: 13, lineHeight: 20 },

    // Potentials
    potentialCard: { padding: 16, borderRadius: 18, gap: 14 },
    potentialRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    potentialLabel: { fontSize: 12, fontWeight: '600', width: 92 },
    potentialBarWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    potentialBarTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
    potentialBarFill: { height: 8, borderRadius: 4 },
    potentialPct: { fontSize: 13, fontWeight: '700', minWidth: 40, textAlign: 'right' },

    // xG
    xgCard: { padding: 18, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
    xgVal: { fontSize: 24, fontWeight: '800' },
    xgLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

    // Match stats
    statsCard: { padding: 16, borderRadius: 18, gap: 16 },
    statBlock: { gap: 6 },
    statValues: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    statNum: { fontSize: 13, fontWeight: '700' },
    statLabel: { fontSize: 11, fontWeight: '500' },
    statBarTrack: { height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row' },
    statBarFill: { height: 6, borderRadius: 3 },

    // Goal timeline
    timelineCard: { padding: 16, borderRadius: 18, gap: 12 },
    goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    goalRowAway: { flexDirection: 'row-reverse' },
    goalInfo: { flex: 1 },
    goalScorer: { fontSize: 13, fontWeight: '600' },
    goalAssist: { fontSize: 11, fontWeight: '500', marginTop: 1 },

    // Lineups
    lineupCard: { padding: 16, borderRadius: 18 },
    lineupCols: { flexDirection: 'row' },
    lineupCol: { flex: 1, gap: 8 },
    lineupDivider: { width: 1, marginHorizontal: 12 },
    lineupTeam: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
    lineupPlayer: { fontSize: 12, fontWeight: '500' },

    // Odds comparison
    ocRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    ocSelection: { fontSize: 12, fontWeight: '700', width: 64 },
    ocScrollWrap: { flex: 1 },
    ocScroll: { gap: 8, alignItems: 'center', paddingRight: 4 },
    ocChip: { minWidth: 54, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, alignItems: 'center', borderWidth: 1 },
    ocBookie: { fontSize: 8, fontWeight: '600', marginBottom: 2, maxWidth: 56 },
    ocValue: { fontSize: 14, fontWeight: '800' },
    });
}
