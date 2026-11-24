import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { DollarSign, Zap, CheckCircle2, Clock, Send, Key, MessageCircle } from 'lucide-react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { MatchCard } from '../../components/MatchCard';
import { DatePickerStrip } from '../../components/DatePickerStrip';
import { EmailRequestDialog, type EmailSubmitResult } from '../../components/EmailRequestDialog';
import { RequestSentDialog } from '../../components/RequestSentDialog';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';
import { typography } from '../../theme/typography';
import { api } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';
import { safeString, safeTime, safeScore } from '../../utils/safeData';
import { getDeviceId } from '../../utils/deviceId';
import { getRequestEmail, saveRequestEmail } from '../../utils/requestEmail';
import { joinTelegram } from '../../lib/telegram';
import { withErrorBoundary } from '../../components/ScreenErrorBoundary';
import { useRouter } from 'expo-router';


type MemberStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'active' | 'loading';

const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const isAlreadyPendingReason = (reason: string | undefined): boolean =>
    typeof reason === 'string' && reason.toLowerCase().includes('already pending');

function PaidTipsScreen() {
    const { themeColors } = useTheme();
    const router = useRouter();
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedLeague, setSelectedLeague] = useState('All');
    const [tokenInput, setTokenInput] = useState('');
    const [enteringToken, setEnteringToken] = useState(false);
    const [verifyingToken, setVerifyingToken] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [deviceId, setDeviceId] = useState('');
    const [emailDialogVisible, setEmailDialogVisible] = useState(false);
    const [sentDialogVisible, setSentDialogVisible] = useState(false);
    const [savedEmail, setSavedEmail] = useState('');
    const { username } = useUser();

    useEffect(() => {
        let cancelled = false;
        void getDeviceId().then((id) => { if (!cancelled) setDeviceId(id); }).catch(() => {});
        void getRequestEmail().then((email) => { if (!cancelled) setSavedEmail(email); }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const {
        data: membershipStatusData,
        loaded: membershipLoaded,
        refetch: refetchMembership,
    } = useScreenQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'paid', username || undefined),
        [deviceId, username],
        { enabled: Boolean(deviceId), pollMs: 60000 },
    );

    const memberStatus: MemberStatus = membershipLoaded
        ? (membershipStatusData?.status ?? 'none')
        : 'loading';

    const {
        data: matchesData,
        loading: matchesLoading,
        refetch: refetchMatches,
    } = useScreenQuery(
        () => api.matches.byTypeAndDate('paid', selectedDate, 100),
        [selectedDate, memberStatus],
        { enabled: memberStatus === 'active', pollMs: 60000 },
    );

    const matches = matchesData ?? [];
    const loading = matchesLoading && memberStatus === 'active';

    const dates = useMemo(() => {
        const d = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            d.push(date.toISOString().split('T')[0]);
        }
        return d;
    }, []);

    const uniqueLeagues = useMemo(() => {
        const leagues = Array.from(new Set(matches.map(m => safeString(m.league)))).sort();
        return ['All', ...leagues];
    }, [matches]);

    const filteredMatches = useMemo(() => {
        return matches.filter(match => {
            const league = safeString(match.league);
            const leagueMatch = selectedLeague === 'All' || league === selectedLeague;
            return leagueMatch;
        });
    }, [matches, selectedLeague]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([refetchMembership(), refetchMatches()]);
        setRefreshing(false);
    }, [refetchMembership, refetchMatches]);

    const requestMembership = () => {
        setEmailDialogVisible(true);
    };

    const handleEmailSubmit = async (email: string): Promise<EmailSubmitResult> => {
        if (!deviceId) {
            return { ok: false, error: 'Device not ready. Please try again.' };
        }
        try {
            const result = await api.tokens.createMembershipRequest(deviceId, 'paid', username || undefined, email);
            if (result.success) {
                await saveRequestEmail(email);
                setEmailDialogVisible(false);
                setSentDialogVisible(true);
                await refetchMembership();
                return { ok: true };
            }
            const reason = safeString(result.reason);
            if (isAlreadyPendingReason(reason || undefined)) {
                return { ok: false, error: 'You already have a Premium request pending.' };
            }
            return { ok: false, error: reason || 'Failed to send request. Please try again.' };
        } catch (e) {
            const message = e instanceof Error && e.message ? e.message : 'Failed to send request. Please try again.';
            return { ok: false, error: message };
        }
    };

    const verifyToken = async () => {
        if (!tokenInput.trim() || !deviceId) return;
        setVerifyingToken(true);
        try {
            const result = await api.tokens.claimToken(
                tokenInput.trim(),
                deviceId,
                username || undefined,
            );
            if (result.success) {
                setEnteringToken(false);
                setTokenInput('');
                Alert.alert('Access Granted!', 'Welcome to Premium!');
                await refetchMembership();
            } else {
                Alert.alert('Invalid Token', safeString(result.reason) || 'This token is not valid for your account.');
            }
        } catch {
            Alert.alert('Error', 'Failed to verify token.');
        }
        setVerifyingToken(false);
    };

    if (memberStatus === 'loading') {
        return (
            <View style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={themeColors.primary} size="large" />
            </View>
        );
    }

    if (memberStatus === 'none' || memberStatus === 'pending' || memberStatus === 'approved' || memberStatus === 'rejected') {
        return (
            <>
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: themeColors.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    contentContainerStyle={styles.gateContainer}
                    keyboardShouldPersistTaps='handled'
                    showsVerticalScrollIndicator={false}
                >
                    <View style={[styles.gateBadge, { backgroundColor: themeColors.orange9 }]}>
                        <DollarSign size={16} color="white" />
                        <Text style={styles.gateBadgeText}>PREMIUM ACCESS REQUIRED</Text>
                    </View>

                    <Text style={[styles.gateTitle, { color: themeColors.text }]}>PREMIUM TIPS</Text>
                    <Text style={[styles.gateSubtitle, { color: themeColors.textMuted }]}>
                        Get exclusive access to our curated premium predictions with expert analysis.
                    </Text>

                    {['Expert-curated premium picks', 'Detailed AI match analysis', 'Higher accuracy predictions', 'Match insights & value bets'].map((f, i) => (
                        <View key={i} style={styles.featureRow}>
                            <CheckCircle2 size={13} color={themeColors.orange9} />
                            <Text style={[styles.featureText, { color: themeColors.text }]}>{f}</Text>
                        </View>
                    ))}

                    {memberStatus === 'none' && !enteringToken && (
                        <TouchableOpacity
                            style={[styles.primaryBtn, { backgroundColor: themeColors.orange9 }]}
                            onPress={requestMembership}
                            disabled={emailDialogVisible}
                        >
                            {emailDialogVisible ? <ActivityIndicator color="white" size="small" /> : (
                                <>
                                    <Send size={15} color="white" />
                                    <Text style={styles.primaryBtnText}>REQUEST PAID ACCESS</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}

                    {memberStatus === 'pending' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.cardBg, borderColor: themeColors.orange9 }]}>
                            <Clock size={18} color={themeColors.orange9} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>Request Under Review</Text>
                            <Text style={[styles.pendingText, { color: themeColors.textMuted }]}>
                                Your request is pending admin approval. You will receive an access token shortly.
                            </Text>
                        </View>
                    )}

                    {memberStatus === 'approved' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.cardBg, borderColor: themeColors.success }]}>
                            <CheckCircle2 size={18} color={themeColors.success} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>Request Approved!</Text>
                            <Text style={[styles.pendingText, { color: themeColors.textMuted }]}>
                                Your Paid access request has been approved. Please enter your token below.
                            </Text>
                        </View>
                    )}

                    {/* Get Premium access - navigate to Store tab */}
                    <TouchableOpacity
                        style={[styles.primaryBtn, { backgroundColor: themeColors.primary }]}
                        onPress={() => router.push('/market')}
                    >
                        <Text style={styles.primaryBtnText}>Get Premium access</Text>
                    </TouchableOpacity>

                    {!enteringToken ? (
                        <View style={styles.tokenRow}>
                            <TouchableOpacity
                                style={[styles.secondaryBtn, { borderColor: themeColors.border, flex: 1 }]}
                                onPress={() => setEnteringToken(true)}
                            >
                                <Key size={13} color={themeColors.textMuted} />
                                <Text style={[styles.secondaryBtnText, { color: themeColors.textMuted }]}>I HAVE A TOKEN</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.telegramBtn, { borderColor: themeColors.border }]}
                                onPress={() => { void joinTelegram(); }}
                            >
                                <MessageCircle size={14} color={themeColors.textMuted} />
                                <Text style={[styles.telegramText, { color: themeColors.textMuted }]}>TELEGRAM</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={[styles.tokenInputCard, { backgroundColor: themeColors.cardBg, borderColor: themeColors.border }]}>
                            <Text style={[styles.tokenInputLabel, { color: themeColors.textMuted }]}>ENTER YOUR ACCESS TOKEN</Text>
                            <TextInput
                                value={tokenInput}
                                onChangeText={setTokenInput}
                                placeholder="e.g. PAD-XXXX-XXXX-XXXX"
                                placeholderTextColor={themeColors.textMuted}
                                style={[styles.tokenInput, { color: themeColors.text, borderColor: themeColors.border, backgroundColor: themeColors.cardBgSecondary }]}
                                autoCapitalize="characters"
                                autoCorrect={false}
                            />
                            <View style={styles.tokenBtnRow}>
                                <TouchableOpacity
                                    style={[styles.primaryBtn, { backgroundColor: themeColors.orange9, flex: 1 }]}
                                    onPress={verifyToken}
                                    disabled={verifyingToken || !tokenInput.trim()}
                                >
                                    {verifyingToken
                                        ? <ActivityIndicator color="white" size="small" />
                                        : <Text style={styles.primaryBtnText}>VERIFY TOKEN</Text>
                                    }
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.cancelBtn, { backgroundColor: themeColors.cardBgSecondary }]}
                                    onPress={() => { setEnteringToken(false); setTokenInput(''); }}
                                >
                                    <Text style={[styles.cancelBtnText, { color: themeColors.textMuted }]}>Cancel</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
            <EmailRequestDialog
                visible={emailDialogVisible}
                title="Premium Membership Request"
                note="We will email your paid-access code when the request is approved."
                submitLabel="Send Request"
                prefillEmail={savedEmail}
                onSubmit={handleEmailSubmit}
                onClose={() => setEmailDialogVisible(false)}
            />
            <RequestSentDialog visible={sentDialogVisible} onClose={() => setSentDialogVisible(false)} />
            </>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <View style={[styles.calendarStrip, { borderBottomColor: 'rgba(255,255,255,0.05)' }]}>
                <DatePickerStrip
                    dates={dates}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                />
            </View>

            <View style={styles.filterSection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.leaguesScroll}>
                    {uniqueLeagues.map(league => (
                        <TouchableOpacity
                            key={league}
                            onPress={() => setSelectedLeague(league)}
                            style={[styles.leagueChip, { backgroundColor: selectedLeague === league ? themeColors.primary : themeColors.cardBgSecondary }]}
                        >
                            <Text style={[styles.leagueChipText, { color: selectedLeague === league ? 'white' : themeColors.textMuted }]}>
                                {league === 'All' ? 'All' : toTitleCase(league)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            <View style={[styles.activeBanner, { backgroundColor: `${themeColors.orange9}15`, borderBottomColor: `${themeColors.orange9}30` }]}>
                <DollarSign size={13} color={themeColors.orange9} />
                <Text style={[styles.activeBannerText, { color: themeColors.orange9 }]}>PAID ACCESS ACTIVE</Text>
            </View>

            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColors.primary} colors={[themeColors.primary]} />}
            >
                <View style={styles.sectionHeader}>
                    <Zap size={14} color={themeColors.orange9} />
                    <Text style={[styles.sectionTitle, { color: themeColors.text }]}>PREMIUM PREDICTIONS</Text>
                </View>

                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={themeColors.primary} />
                    </View>
                ) : filteredMatches.length > 0 ? (
                    <View style={styles.fixtureGrid}>
                        {filteredMatches.map((match) => (
                            <MatchCard
                                key={safeString(match.id)}
                                matchId={safeString(match.id)}
                                matchData={match}
                                leagueName={safeString(match.league)}
                                leagueLogo={safeString(match.leagueLogo)}
                                time={safeTime(match.timestamp)}
                                homeTeam={safeString(match.homeTeam)}
                                homeTeamLogo={safeString(match.homeTeamLogo)}
                                awayTeam={safeString(match.awayTeam)}
                                awayTeamLogo={safeString(match.awayTeamLogo)}
                                isLocked={false}
                                aiInsight={match.aiPrediction}
                                prediction={safeString(match.aiPrediction?.prediction)}
                                odds={safeString(match.odds?.home)}
                            />
                        ))}
                    </View>
                ) : (
                    <View style={styles.emptyContainer}>
                        <View style={[styles.emptyIconWrapper, { backgroundColor: themeColors.cardBgSecondary }]}>
                            <DollarSign size={36} color={themeColors.textMuted} />
                        </View>
                        <Text style={[styles.emptyText, { color: themeColors.text }]}>No Paid Tips Today</Text>
                        <Text style={[styles.emptySubtext, { color: themeColors.textMuted }]}>
                            Our analysts are currently vetting the next set of value picks.
                        </Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    gateContainer: { padding: 28, paddingTop: 48, alignItems: 'center', gap: 16, paddingBottom: 100 },
    gateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginBottom: 4 },
    gateBadgeText: { ...typography.gateBadge, color: 'white' },
    gateTitle: { ...typography.gateTitle },
    gateSubtitle: { ...typography.gateSubtitle, textAlign: 'center', paddingHorizontal: 16 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', width: '100%', paddingHorizontal: 8 },
    featureText: { ...typography.featureText },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 16, width: '100%', marginTop: 8 },
    primaryBtnText: { ...typography.primaryBtn, color: 'white' },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, width: '100%', borderWidth: 1 },
    secondaryBtnText: { ...typography.secondaryBtn },
    pendingCard: { width: '100%', padding: 20, borderRadius: 18, alignItems: 'center', gap: 10, borderWidth: 1, borderStyle: 'dashed' },
    pendingTitle: { ...typography.pendingTitle },
    pendingText: { ...typography.pendingText, textAlign: 'center' },
    tokenInputCard: { width: '100%', padding: 20, borderRadius: 18, borderWidth: 1, gap: 12 },
    tokenInputLabel: { ...typography.tokenLabel },
    tokenInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, ...typography.tokenInput },
    tokenBtnRow: { flexDirection: 'row', gap: 10 },
    tokenRow: { flexDirection: 'row', gap: 10 },
    telegramBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 13,
        borderRadius: 14,
        borderWidth: 1,
    },
    telegramText: { ...typography.secondaryBtn },
    cancelBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, justifyContent: 'center' },
    cancelBtnText: { ...typography.cancelBtn },
    activeBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, justifyContent: 'center' },
    activeBannerText: { ...typography.sectionLabel },
    calendarStrip: { borderBottomWidth: 1, paddingBottom: 2 },
    filterSection: { paddingHorizontal: 14, paddingTop: 8 },
    leaguesScroll: { paddingVertical: 4, gap: 8 },
    leagueChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    leagueChipText: { ...typography.chipText },
    content: { flex: 1 },
    scrollContent: { padding: 14, paddingTop: 14, paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    sectionTitle: { ...typography.sectionTitle },
    loadingContainer: { paddingVertical: 60, alignItems: 'center' },
    fixtureGrid: { gap: 8 },
    emptyContainer: { paddingVertical: 60, alignItems: 'center', gap: 14 },
    emptyIconWrapper: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
    emptyText: { ...typography.emptyText },
    emptySubtext: { ...typography.emptySubtext, textAlign: 'center', paddingHorizontal: 36 },
});

export default withErrorBoundary(PaidTipsScreen);
