import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, ActivityIndicator, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ChevronLeft, Zap, ShieldCheck, Goal } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { typography } from '../../theme/typography';
import { getCountryFlagUrl } from '../../lib/flags';
import { fetchMatchStats } from '../../api/footystats';
import type { MatchDetailData } from '../../api/footystats';
import { api } from '../../api/client';
import type { ApiMatch } from '../../api/client';
import { safeString, safeNumber, safeScore, safeTime, safeDateTime } from '../../utils/safeData';

type MatchViewModel = Omit<
    ApiMatch,
    'h2h' | 'detailedOdds' | 'homeLineup' | 'awayLineup' | 'goals' | 'stats' | 'potentials' | 'oddsComparison'
> &
    Partial<MatchDetailData>;

const { width } = Dimensions.get('window');

const TeamLogo = ({ uri, name, textColor }: { uri?: string; name: string; textColor: string }) => {
    const [failed, setFailed] = useState(false);
    const safeName = safeString(name);
    const initials = safeName.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
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

const logoStyles = StyleSheet.create({
    img: { width: 46, height: 46, resizeMode: 'contain' },
    flagBox: { width: 46, height: 46, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(128,128,128,0.08)', alignItems: 'center', justifyContent: 'center' },
    flag: { width: 46, height: 30, resizeMode: 'cover' },
    initials: { fontSize: 18, fontWeight: '800', letterSpacing: 1 },
});

export default function MatchDetailScreen() {
    const { id, matchData } = useLocalSearchParams();
    const router = useRouter();
    const { themeColors } = useTheme();

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
                <ActivityIndicator size="large" color={themeColors.primary} />
            </SafeAreaView>
        );
    }

    if (!match) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center', alignItems: 'center' }]} edges={['left', 'right']}>
                <Text style={{ color: themeColors.textMuted }}>Match details unavailable</Text>
                <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
                    <Text style={{ color: themeColors.primary, fontWeight: '700' }}>GO BACK</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const isLive = safeString(match.status).includes('Live') || safeString(match.status) === 'Halftime';
    const isFinished = safeString(match.status) === 'Finished' || safeString(match.status) === 'FT';

    // Null-safe locals for the scoreboard below.
    const safeLeague = safeString(match.league);
    const safeHomeTeam = safeString(match.homeTeam);
    const safeAwayTeam = safeString(match.awayTeam);
    const safeCountry = safeString(match.country);
    const safeStatus = safeString(match.status);
    const homeScore = safeScore(match.homeScore);
    const awayScore = safeScore(match.awayScore);
    const htHomeScore = safeScore(match.htHomeScore);
    const htAwayScore = safeScore(match.htAwayScore);
    const tvStations = Array.isArray(match.tvStations) ? match.tvStations : [];

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: themeColors.background }]} edges={['left', 'right']}>
            {/* Custom Header */}
            <View style={[styles.customHeader, { backgroundColor: themeColors.background }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.headerLeft}>
                    <ChevronLeft size={24} color={themeColors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: themeColors.text }]}>
                    {safeLeague ? safeLeague.replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : 'Match Details'}
                </Text>
                <View style={styles.headerRight} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

                {/* Hero Scoreboard */}
                <View style={[styles.scoreboard, { backgroundColor: themeColors.cardBgSecondary }]}>
                    <View style={styles.leagueRow}>
                        <ShieldCheck size={11} color={themeColors.textMuted} />
                        <Text style={[styles.leagueText, { color: themeColors.textMuted }]}>
                            {safeLeague.replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())}
                        </Text>
                        {safeCountry && (
                            <Text style={[styles.countryText, { color: themeColors.textMuted }]}>• {safeCountry}</Text>
                        )}
                    </View>

                    {/* Status Badge */}
                    <View style={[
                        styles.statusBadge,
                        {
                            backgroundColor: isLive ? '#ef4444' : isFinished ? themeColors.cardBg : themeColors.cardBg,
                        }
                    ]}>
                        {isLive && <View style={styles.liveDot} />}
                        <Text style={[
                            styles.statusText,
                            { color: isLive ? 'white' : themeColors.textMuted }
                        ]}>
                            {isLive ? safeStatus.toUpperCase() : isFinished ? 'FULL TIME' : 'UPCOMING'}
                        </Text>
                    </View>

                    {/* Teams + Score */}
                    <View style={styles.teamsRow}>
                        <View style={styles.teamCol}>
                            <View style={[styles.logoBox, { backgroundColor: themeColors.cardBg }]}>
                                <TeamLogo uri={match.homeTeamLogo} name={safeHomeTeam} textColor={themeColors.textMuted} />
                            </View>
                            <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={2}>{safeHomeTeam}</Text>
                            {match.homeStanding && (
                                <Text style={[styles.standingText, { color: themeColors.textMuted }]}>#{safeString(match.homeStanding)}</Text>
                            )}
                        </View>

                        <View style={styles.scoreCol}>
                            {homeScore !== undefined ? (
                                <Text style={[styles.scoreText, { color: themeColors.primary }]}>
                                    {homeScore} — {awayScore ?? ''}
                                </Text>
                            ) : (
                                <Text style={[styles.vsText, { color: themeColors.text }]}>VS</Text>
                            )}
                            <Text style={[styles.kickoffText, { color: themeColors.textMuted }]}>
                                {safeDateTime(match.timestamp)}
                            </Text>
                            {(htHomeScore !== undefined && htAwayScore !== undefined) && (
                                <Text style={[styles.htText, { color: themeColors.textMuted }]}>
                                    HT {htHomeScore} - {htAwayScore}
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
                            <View style={[styles.logoBox, { backgroundColor: themeColors.cardBg }]}>
                                <TeamLogo uri={match.awayTeamLogo} name={safeAwayTeam} textColor={themeColors.textMuted} />
                            </View>
                            <Text style={[styles.teamName, { color: themeColors.text }]} numberOfLines={2}>{safeAwayTeam}</Text>
                            {match.awayStanding && (
                                <Text style={[styles.standingText, { color: themeColors.textMuted }]}>#{safeString(match.awayStanding)}</Text>
                            )}
                        </View>
                    </View>
                </View>

                {/* Match Predictions (pre-match probability potentials) */}
                {match.potentials && match.potentials.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>MATCH PREDICTIONS</Text>
                        <View style={[styles.potentialCard, { backgroundColor: themeColors.cardBg }]}>
                            {match.potentials.map((p, i: number) => {
                                const percent = safeNumber(p.percent, NaN);
                                const pct = Number.isNaN(percent) ? NaN : Math.min(100, Math.max(0, percent));
                                return (
                                    <View key={i} style={styles.potentialRow}>
                                        <Text style={[styles.potentialLabel, { color: themeColors.text }]}>{safeString(p.label)}</Text>
                                        {!Number.isNaN(pct) ? (
                                            <View style={styles.potentialBarWrap}>
                                                <View style={[styles.potentialBarTrack, { backgroundColor: themeColors.cardBgSecondary }]}>
                                                    <View style={[styles.potentialBarFill, { width: `${pct}%`, backgroundColor: themeColors.primary }]} />
                                                </View>
                                                <Text style={[styles.potentialPct, { color: themeColors.primary }]}>{pct}%</Text>
                                            </View>
                                        ) : (
                                            <Text style={[styles.potentialPct, { color: themeColors.primary }]}>{safeString(p.value)}</Text>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                )}

                {/* Market Odds - Show detailedOdds if available, otherwise fall back to basic odds */}
                {(match.detailedOdds || match.odds) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>MARKET ODDS</Text>
                        <View style={styles.oddsGrid}>
                            <View style={[styles.oddsTile, { backgroundColor: themeColors.cardBg }]}>
                                <Text style={[styles.tileLabel, { color: themeColors.textMuted }]}>FULL TIME 1X2</Text>
                                <View style={styles.oddsRow}>
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.primary }]}>
                                            {match.detailedOdds?.ft?.['1x2']?.home || match.odds?.home || '—'}
                                        </Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>HOME</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>
                                            {match.detailedOdds?.ft?.['1x2']?.draw || match.odds?.draw || '—'}
                                        </Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>DRAW</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>
                                            {match.detailedOdds?.ft?.['1x2']?.away || match.odds?.away || '—'}
                                        </Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>AWAY</Text>
                                    </View>
                                </View>
                            </View>

                            {match.detailedOdds?.ft?.['ou'] && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.cardBg }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.textMuted }]}>GOALS OVER / UNDER</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft['ou'].over || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>OVER {match.detailedOdds.ft['ou'].line}</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft['ou'].under || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>UNDER {match.detailedOdds.ft['ou'].line}</Text>
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
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>DETAILED ODDS</Text>
                        <View style={styles.oddsGrid}>
                            {/* FT 1X2 */}
                            <View style={[styles.oddsTile, { backgroundColor: themeColors.cardBg }]}>
                                <Text style={[styles.tileLabel, { color: themeColors.textMuted }]}>FULL TIME 1X2</Text>
                                <View style={styles.oddsRow}>
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.primary }]}>{match.detailedOdds.ft?.['1x2'].home || '—'}</Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>HOME</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft?.['1x2'].draw || '—'}</Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>DRAW</Text>
                                    </View>
                                    <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                    <View style={styles.oddsCell}>
                                        <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft?.['1x2'].away || '—'}</Text>
                                        <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>AWAY</Text>
                                    </View>
                                </View>
                            </View>

                            {/* FT O/U */}
                            {match.detailedOdds.ft?.ou && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.cardBg }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.textMuted }]}>FT OVER / UNDER ({match.detailedOdds.ft.ou.line})</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ou.over}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>OVER</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ou.under}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>UNDER</Text>
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* FT AH */}
                            {match.detailedOdds.ft?.ah && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.cardBg }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.textMuted }]}>FT ASIAN HANDICAP ({match.detailedOdds.ft.ah.line})</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ah.home}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>HOME</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ft.ah.away}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>AWAY</Text>
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* HT 1X2 */}
                            {match.detailedOdds.ht?.['1x2'] && (match.detailedOdds.ht['1x2'].home || match.detailedOdds.ht['1x2'].draw || match.detailedOdds.ht['1x2'].away) && (
                                <View style={[styles.oddsTile, { backgroundColor: themeColors.cardBg }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.textMuted }]}>HALF TIME 1X2</Text>
                                    <View style={styles.oddsRow}>
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.primary }]}>{match.detailedOdds.ht['1x2'].home || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>HOME</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ht['1x2'].draw || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>DRAW</Text>
                                        </View>
                                        <View style={[styles.oddsDivider, { backgroundColor: themeColors.border }]} />
                                        <View style={styles.oddsCell}>
                                            <Text style={[styles.oddsVal, { color: themeColors.text }]}>{match.detailedOdds.ht['1x2'].away || '—'}</Text>
                                            <Text style={[styles.oddsSub, { color: themeColors.textMuted }]}>AWAY</Text>
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
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>ODDS COMPARISON</Text>
                        <View style={styles.oddsGrid}>
                            {match.oddsComparison.map((m, i: number) => (
                                <View key={i} style={[styles.oddsTile, { backgroundColor: themeColors.cardBg }]}>
                                    <Text style={[styles.tileLabel, { color: themeColors.textMuted }]}>{safeString(m.market).toUpperCase()}</Text>
                                    {(m.selections || []).map((sel, j: number) => {
                                        const selOdds = sel.odds || [];
                                        const vals = selOdds.map((o) => parseFloat(safeString(o.value))).filter((n: number) => !isNaN(n));
                                        const best = vals.length ? Math.max(...vals) : null;
                                        return (
                                            <View key={j} style={styles.ocRow}>
                                                <Text style={[styles.ocSelection, { color: themeColors.text }]} numberOfLines={2}>{safeString(sel.name)}</Text>
                                                <ScrollView
                                                    horizontal
                                                    showsHorizontalScrollIndicator={false}
                                                    style={styles.ocScrollWrap}
                                                    contentContainerStyle={styles.ocScroll}
                                                >
                                                    {selOdds.map((o, k: number) => {
                                                        const isBest = best !== null && parseFloat(safeString(o.value)) === best;
                                                        return (
                                                            <View
                                                                key={k}
                                                                style={[
                                                                    styles.ocChip,
                                                                    { backgroundColor: themeColors.cardBgSecondary, borderColor: 'transparent' },
                                                                    isBest && { backgroundColor: `${themeColors.primary}1A`, borderColor: themeColors.primary },
                                                                ]}
                                                            >
                                                                <Text style={[styles.ocBookie, { color: themeColors.textMuted }]} numberOfLines={1}>{safeString(o.bookie)}</Text>
                                                                <Text style={[styles.ocValue, { color: isBest ? themeColors.primary : themeColors.text }]}>{safeString(o.value) || '—'}</Text>
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
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>HEAD TO HEAD</Text>
                        <View style={[styles.h2hCard, { backgroundColor: themeColors.cardBg }]}>
                            <View style={styles.h2hRow}>
                                <View style={styles.h2hStat}>
                                    <Text style={[styles.h2hVal, { color: themeColors.primary }]}>{safeNumber(match.h2h.summary.wins)}</Text>
                                    <Text style={[styles.h2hLabel, { color: themeColors.textMuted }]}>HOME WINS</Text>
                                </View>
                                <View style={styles.h2hStat}>
                                    <Text style={[styles.h2hVal, { color: themeColors.text }]}>{safeNumber(match.h2h.summary.draws)}</Text>
                                    <Text style={[styles.h2hLabel, { color: themeColors.textMuted }]}>DRAWS</Text>
                                </View>
                                <View style={styles.h2hStat}>
                                    <Text style={[styles.h2hVal, { color: themeColors.text }]}>{safeNumber(match.h2h.summary.losses)}</Text>
                                    <Text style={[styles.h2hLabel, { color: themeColors.textMuted }]}>AWAY WINS</Text>
                                </View>
                            </View>
                            {/* Visual bar */}
                            <View style={styles.h2hBar}>
                                <View style={[styles.h2hBarSegment, {
                                    backgroundColor: themeColors.primary,
                                    flex: safeNumber(match.h2h.summary.wins) || 1,
                                }]} />
                                <View style={[styles.h2hBarSegment, {
                                    backgroundColor: themeColors.border,
                                    flex: safeNumber(match.h2h.summary.draws) || 1,
                                }]} />
                                <View style={[styles.h2hBarSegment, {
                                    backgroundColor: themeColors.textMuted,
                                    flex: safeNumber(match.h2h.summary.losses) || 1,
                                }]} />
                            </View>
                        </View>
                    </View>
                )}

                {/* H2H History */}
                {match.h2h?.history && match.h2h.history.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>H2H HISTORY</Text>
                        <View style={[styles.h2hHistoryCard, { backgroundColor: themeColors.cardBg }]}>
                            {match.h2h.history.map((h, i: number) => (
                                <View key={i} style={[styles.h2hHistoryRow, i < match.h2h!.history!.length - 1 && { borderBottomWidth: 1, borderBottomColor: themeColors.border }]}>
                                    <View style={styles.h2hHistoryLeft}>
                                        <Text style={[styles.h2hHistoryLeague, { color: themeColors.textMuted }]}>{safeString(h.league)}</Text>
                                        <Text style={[styles.h2hHistoryTeams, { color: themeColors.text }]}>{safeString(h.home)} vs {safeString(h.away)}</Text>
                                    </View>
                                    <View style={styles.h2hHistoryRight}>
                                        <Text style={[styles.h2hHistoryScore, { color: themeColors.primary }]}>{safeString(h.score)}</Text>
                                        <Text style={[styles.h2hHistoryDate, { color: themeColors.textMuted }]}>{safeString(h.date)}</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                {/* Team Form */}
                {(match.homeForm || match.awayForm) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>RECENT FORM</Text>
                        <View style={[styles.formCard, { backgroundColor: themeColors.cardBg }]}>
                            {match.homeForm && (
                                <View style={styles.formRow}>
                                    <Text style={[styles.formTeam, { color: themeColors.text }]}>{safeString(match.homeTeam)}</Text>
                                    <View style={styles.formStreak}>
                                        {safeString(match.homeForm).split('').slice(0, 5).map((char: string, i: number) => (
                                            <View key={i} style={[styles.formBadge, {
                                                backgroundColor: char === 'W' ? '#15783a' : char === 'D' ? themeColors.orange9 : '#EF4444'
                                            }]}>
                                                <Text style={styles.formBadgeText}>{char}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )}
                            {match.awayForm && (
                                <View style={[styles.formRow, match.homeForm && { borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 12, marginTop: 12 }]}>
                                    <Text style={[styles.formTeam, { color: themeColors.text }]}>{safeString(match.awayTeam)}</Text>
                                    <View style={styles.formStreak}>
                                        {safeString(match.awayForm).split('').slice(0, 5).map((char: string, i: number) => (
                                            <View key={i} style={[styles.formBadge, {
                                                backgroundColor: char === 'W' ? '#15783a' : char === 'D' ? themeColors.orange9 : '#EF4444'
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
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>STARTING LINEUPS</Text>
                        <View style={[styles.lineupCard, { backgroundColor: themeColors.cardBg }]}>
                            <View style={styles.lineupCols}>
                                <View style={styles.lineupCol}>
                                    <Text style={[styles.lineupTeam, { color: themeColors.primary }]} numberOfLines={1}>{safeHomeTeam}</Text>
                                    {(match.homeLineup || []).map((p, i: number) => (
                                        <Text key={i} style={[styles.lineupPlayer, { color: themeColors.text }]} numberOfLines={1}>
                                            {safeString(p.number) ? `${safeString(p.number)}. ` : ''}{safeString(p.name)}
                                        </Text>
                                    ))}
                                </View>
                                <View style={[styles.lineupDivider, { backgroundColor: themeColors.border }]} />
                                <View style={styles.lineupCol}>
                                    <Text style={[styles.lineupTeam, { color: themeColors.text }]} numberOfLines={1}>{safeAwayTeam}</Text>
                                    {(match.awayLineup || []).map((p, i: number) => (
                                        <Text key={i} style={[styles.lineupPlayer, { color: themeColors.text }]} numberOfLines={1}>
                                            {safeString(p.number) ? `${safeString(p.number)}. ` : ''}{safeString(p.name)}
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
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>EXPECTED GOALS (xG)</Text>
                        <View style={[styles.xgCard, { backgroundColor: themeColors.cardBg }]}>
                            <Text style={[styles.xgVal, { color: themeColors.primary }]}>{safeNumber(match.homeXg).toFixed(2)}</Text>
                            <Text style={[styles.xgLabel, { color: themeColors.textMuted }]}>xG</Text>
                            <Text style={[styles.xgVal, { color: themeColors.text }]}>{safeNumber(match.awayXg).toFixed(2)}</Text>
                        </View>
                    </View>
                )}

                {/* Match Stats (possession, shots, etc.) */}
                {match.stats && match.stats.length > 0 && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>MATCH STATS</Text>
                        <View style={[styles.statsCard, { backgroundColor: themeColors.cardBg }]}>
                            {match.stats.map((s, i: number) => {
                                const home = safeNumber(s.home);
                                const away = safeNumber(s.away);
                                const total = (home + away) || 1;
                                const homePct = Math.round((home / total) * 100);
                                return (
                                    <View key={i} style={styles.statBlock}>
                                        <View style={styles.statValues}>
                                            <Text style={[styles.statNum, { color: themeColors.text }]}>{home}{s.percent ? '%' : ''}</Text>
                                            <Text style={[styles.statLabel, { color: themeColors.textMuted }]}>{safeString(s.label)}</Text>
                                            <Text style={[styles.statNum, { color: themeColors.text }]}>{away}{s.percent ? '%' : ''}</Text>
                                        </View>
                                        <View style={[styles.statBarTrack, { backgroundColor: themeColors.cardBgSecondary }]}>
                                            <View style={[styles.statBarFill, { width: `${homePct}%`, backgroundColor: themeColors.primary }]} />
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
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>GOALS</Text>
                        <View style={[styles.timelineCard, { backgroundColor: themeColors.cardBg }]}>
                            {match.goals.map((g, i: number) => (
                                <View key={i} style={[styles.goalRow, safeString(g.team) === 'away' && styles.goalRowAway]}>
                                    <Goal size={14} color={themeColors.primary} />
                                    <View style={[styles.goalInfo, safeString(g.team) === 'away' && { alignItems: 'flex-end' }]}>
                                        <Text style={[styles.goalScorer, { color: themeColors.text }]}>{safeString(g.scorer)} {safeString(g.time)}'</Text>
                                        {safeString(g.assist) && (
                                            <Text style={[styles.goalAssist, { color: themeColors.textMuted }]}>assist: {safeString(g.assist)}</Text>
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
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>CORNER STATS</Text>
                        <View style={[styles.infoCard, { backgroundColor: themeColors.cardBg }]}>
                            <View style={styles.infoRow}>
                                <Text style={[styles.infoKey, { color: themeColors.textMuted }]}>{safeHomeTeam}</Text>
                                <Text style={[styles.infoVal, { color: themeColors.text }]}>{safeNumber(match.homeCorners)}</Text>
                            </View>
                            <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: themeColors.border, paddingTop: 12 }]}>
                                <Text style={[styles.infoKey, { color: themeColors.textMuted }]}>{safeAwayTeam}</Text>
                                <Text style={[styles.infoVal, { color: themeColors.text }]}>{safeNumber(match.awayCorners)}</Text>
                            </View>
                        </View>
                    </View>
                )}

                {/* Match Info */}
                {(match.stadium || match.attendance !== undefined || tvStations.length > 0 || match.referee || match.weather) && (
                    <View style={styles.outerPad}>
                        <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>MATCH INFO</Text>
                        <View style={[styles.infoCard, { backgroundColor: themeColors.cardBg }]}>
                            {match.stadium && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.textMuted }]}>VENUE</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]} numberOfLines={1}>{safeString(match.stadium)}</Text>
                                </View>
                            )}
                            {match.attendance !== undefined && match.attendance !== null && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.textMuted }]}>ATTENDANCE</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]}>{safeNumber(match.attendance).toLocaleString()}</Text>
                                </View>
                            )}
                            {tvStations.length > 0 && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.textMuted }]}>TV</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]} numberOfLines={1}>{safeString(tvStations.join(', '))}</Text>
                                </View>
                            )}
                            {match.referee && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.textMuted }]}>REFEREE</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]}>{safeString(match.referee)}</Text>
                                </View>
                            )}
                            {match.weather && (
                                <View style={styles.infoRow}>
                                    <Text style={[styles.infoKey, { color: themeColors.textMuted }]}>WEATHER</Text>
                                    <Text style={[styles.infoVal, { color: themeColors.text }]}>{safeString(match.weather)}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                )}

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
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
        shadowColor: '#000',
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
        shadowColor: '#000',
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
        borderBottomColor: 'rgba(255,255,255,0.05)',
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
