import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Crown, Key, CheckCircle2, Clock, Send } from 'lucide-react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { MatchCard } from '../../components/MatchCard';
import { DatePickerStrip } from '../../components/DatePickerStrip';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { useUser } from '../../context/UserContext';
import { typography } from '../../theme/typography';
import { api } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';
import { useRouter } from 'expo-router';
import * as Application from 'expo-application';


type MemberStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'active' | 'loading';

const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export default function VIPTipsScreen() {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const router = useRouter();
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedLeague, setSelectedLeague] = useState('All');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [tokenInput, setTokenInput] = useState('');
    const [enteringToken, setEnteringToken] = useState(false);
    const [verifyingToken, setVerifyingToken] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [deviceId, setDeviceId] = useState('');
    const { username } = useUser();

    useEffect(() => {
        const id = Application.applicationId + '_' + (Application.nativeApplicationVersion || 'v1');
        setDeviceId(id);
    }, []);

    const {
        data: membershipStatusData,
        loaded: membershipLoaded,
        refetch: refetchMembership,
    } = useScreenQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'vip', username || undefined),
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
        () => api.matches.byTypeAndDate('vip', selectedDate, 100),
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
        const leagues = Array.from(new Set(matches.map(m => m.league))).sort();
        return ['All', ...leagues];
    }, [matches]);

    const filteredMatches = useMemo(() => {
        return matches.filter(match => {
            const leagueMatch = selectedLeague === 'All' || match.league === selectedLeague;
            return leagueMatch;
        });
    }, [matches, selectedLeague]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await Promise.all([refetchMembership(), refetchMatches()]);
        setRefreshing(false);
    }, [refetchMembership, refetchMatches]);

    const requestMembership = async () => {
        if (!deviceId) return;
        setRequesting(true);
        try {
            await api.tokens.createMembershipRequest(deviceId, 'vip', username || undefined);
            Alert.alert('Request Sent!', 'Your VIP membership request has been submitted. You will receive a token once approved by admin.');
            await refetchMembership();
        } catch {
            Alert.alert('Error', 'Failed to send request. Please try again.');
        }
        setRequesting(false);
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
                Alert.alert('Access Granted!', 'Welcome to VIP! You now have access to elite predictions.');
                await refetchMembership();
            } else {
                Alert.alert('Invalid Token', result.reason || 'This token is not valid for your account.');
            }
        } catch {
            Alert.alert('Error', 'Failed to verify token. Please try again.');
        }
        setVerifyingToken(false);
    };

    // ---- Gate: loading membership ----
    if (memberStatus === 'loading') {
        return (
            <View style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={themeColors.accent} size="large" />
            </View>
        );
    }

    // ---- Gate: not a member ----
    if (memberStatus === 'none' || memberStatus === 'pending' || memberStatus === 'approved' || memberStatus === 'rejected') {
        return (
            <KeyboardAvoidingView
                style={[styles.container, { backgroundColor: themeColors.background }]}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    contentContainerStyle={styles.gateContainer}
                    keyboardShouldPersistTaps='handled'
                    showsVerticalScrollIndicator={false}
                >
                    <View style={[styles.gateBadge, { backgroundColor: themeColors.accent }]}>
                        <Crown size={18} color="white" />
                        <Text style={styles.gateBadgeText}>ELITE ACCESS REQUIRED</Text>
                    </View>

                    <Text style={[styles.gateTitle, { color: themeColors.text }]}>JOIN THE 1%</Text>
                    <Text style={[styles.gateSubtitle, { color: themeColors.mutedText }]}>
                        Get access to our most accurate AI predictions with verified 90%+ strike rate.
                    </Text>

                    {/* Features */}
                    {['Expert AI analysis on every match', 'Verified 90%+ accuracy predictions', 'Exclusive VIP-only picks', 'Priority support'].map((f, i) => (
                        <View key={i} style={styles.featureRow}>
                            <CheckCircle2 size={14} color={themeColors.accent} />
                            <Text style={[styles.featureText, { color: themeColors.text }]}>{f}</Text>
                        </View>
                    ))}

                    {/* Request membership */}
                    {memberStatus === 'none' && !enteringToken && (
                        <TouchableOpacity
                            style={[styles.primaryBtn, { backgroundColor: themeColors.accent }]}
                            onPress={requestMembership}
                            disabled={requesting}
                        >
                            {requesting ? <ActivityIndicator color="white" size="small" /> : (
                                <>
                                    <Send size={16} color="white" />
                                    <Text style={styles.primaryBtnText}>REQUEST VIP MEMBERSHIP</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    )}

                    {/* Pending state */}
                    {memberStatus === 'pending' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.surface, borderColor: themeColors.accent }]}>
                            <Clock size={20} color={themeColors.accent} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>Request Under Review</Text>
                            <Text style={[styles.pendingText, { color: themeColors.mutedText }]}>
                                Your request is pending admin approval. Once approved, you will receive an access token.
                            </Text>
                        </View>
                    )}

                    {/* Approved state */}
                    {memberStatus === 'approved' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.surface, borderColor: themeColors.success }]}>
                            <CheckCircle2 size={20} color={themeColors.success} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>Request Approved!</Text>
                            <Text style={[styles.pendingText, { color: themeColors.mutedText }]}>
                                Your VIP access request has been approved. Please enter your token below to unlock it.
                            </Text>
                        </View>
                    )}

                    {/* Get VIP access - navigate to Store tab */}
                    <TouchableOpacity
                        style={[styles.primaryBtn, { backgroundColor: themeColors.accent }]}
                        onPress={() => router.push('/market')}
                    >
                        <Text style={styles.primaryBtnText}>Get VIP access</Text>
                    </TouchableOpacity>

                    {/* Enter token */}
                    {!enteringToken ? (
                        <TouchableOpacity
                            style={[styles.secondaryBtn, { borderColor: themeColors.border }]}
                            onPress={() => setEnteringToken(true)}
                        >
                            <Key size={14} color={themeColors.mutedText} />
                            <Text style={[styles.secondaryBtnText, { color: themeColors.mutedText }]}>I HAVE A TOKEN</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={[styles.tokenInputCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
                            <Text style={[styles.tokenInputLabel, { color: themeColors.mutedText }]}>ENTER YOUR ACCESS TOKEN</Text>
                            <TextInput
                                value={tokenInput}
                                onChangeText={setTokenInput}
                                placeholder="e.g. VIP-XXXX-XXXX-XXXX"
                                placeholderTextColor={themeColors.mutedText}
                                style={[styles.tokenInput, { color: themeColors.text, borderColor: themeColors.border, backgroundColor: themeColors.surfaceElevated }]}
                                autoCapitalize="characters"
                                autoCorrect={false}
                            />
                            <View style={styles.tokenBtnRow}>
                                <TouchableOpacity
                                    style={[styles.primaryBtn, { backgroundColor: themeColors.accent, flex: 1 }]}
                                    onPress={verifyToken}
                                    disabled={verifyingToken || !tokenInput.trim()}
                                >
                                    {verifyingToken
                                        ? <ActivityIndicator color="white" size="small" />
                                        : <Text style={styles.primaryBtnText}>VERIFY TOKEN</Text>
                                    }
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.cancelBtn, { backgroundColor: themeColors.surfaceElevated }]}
                                    onPress={() => { setEnteringToken(false); setTokenInput(''); }}
                                >
                                    <Text style={[styles.cancelBtnText, { color: themeColors.mutedText }]}>Cancel</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        );
    }

    // ---- Approved member: show matches ----
    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            {/* Calendar strip */}
            <View style={[styles.calendarStrip, { borderBottomColor: themeColors.border }]}>
                <DatePickerStrip
                    dates={dates}
                    selectedDate={selectedDate}
                    onSelectDate={(date) => {
                        setSelectedDate(date);
                        setExpandedId(null);
                    }}
                />
            </View>

            {/* League filter */}
            <View style={styles.filterSection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.leaguesScroll}>
                    {uniqueLeagues.map((league) => (
                        <TouchableOpacity
                            key={league}
                            onPress={() => {
                                setSelectedLeague(league);
                                setExpandedId(null);
                            }}
                            style={[
                                styles.leagueChip,
                                { backgroundColor: selectedLeague === league ? themeColors.accent : themeColors.surfaceElevated },
                            ]}
                        >
                            <Text style={[styles.leagueChipText, { color: selectedLeague === league ? 'white' : themeColors.mutedText }]}>
                                {league === 'All' ? 'All' : toTitleCase(league)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* VIP active badge */}
            <View style={[styles.activeBanner, { backgroundColor: `${themeColors.accent}15`, borderColor: `${themeColors.accent}30` }]}>
                <Crown size={14} color={themeColors.accent} />
                <Text style={[styles.activeBannerText, { color: themeColors.accent }]}>VIP ACCESS ACTIVE</Text>
            </View>

            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColors.accent} colors={[themeColors.accent]} />}
            >
                <View style={styles.sectionHeader}>
                    <Crown size={14} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.text }]}>TODAY'S VIP PICKS</Text>
                </View>

                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={themeColors.accent} />
                    </View>
                ) : filteredMatches.length > 0 ? (
                    <View style={styles.fixtureGrid}>
                        {filteredMatches.map((match) => (
                            <MatchCard
                                key={match.id}
                                match={match}
                                expanded={expandedId === match.id}
                                onToggle={() => setExpandedId((prev) => (prev === match.id ? null : match.id))}
                                access={{ paid: false, vip: memberStatus === 'active' }}
                            />
                        ))}
                    </View>
                ) : (
                    <View style={styles.emptyContainer}>
                        <View style={[styles.emptyIconWrapper, { backgroundColor: themeColors.surfaceElevated }]}>
                            <Crown size={36} color={themeColors.mutedText} />
                        </View>
                        <Text style={[styles.emptyText, { color: themeColors.text }]}>No VIP Tips Today</Text>
                        <Text style={[styles.emptySubtext, { color: themeColors.mutedText }]}>
                            New elite predictions are being analyzed. Check back soon.
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

    // Gate screen
    gateContainer: {
        padding: 28,
        paddingTop: 48,
        alignItems: 'center',
        gap: 16,
        paddingBottom: 100,
    },
    gateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
        marginBottom: 4,
    },
    gateBadgeText: { ...typography.gateBadge, color: 'white' },
    gateTitle: { ...typography.gateTitle },
    gateSubtitle: { ...typography.gateSubtitle, textAlign: 'center', paddingHorizontal: 16 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', width: '100%', paddingHorizontal: 8 },
    featureText: { ...typography.featureText },
    primaryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 16,
        borderRadius: 16,
        width: '100%',
        marginTop: 8,
    },
    primaryBtnText: { ...typography.primaryBtn, color: 'white' },
    secondaryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 13,
        borderRadius: 14,
        width: '100%',
        borderWidth: 1,
    },
    secondaryBtnText: { ...typography.secondaryBtn },
    pendingCard: {
        width: '100%',
        padding: 20,
        borderRadius: 18,
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    pendingTitle: { ...typography.pendingTitle },
    pendingText: { ...typography.pendingText, textAlign: 'center' },
    tokenInputCard: {
        width: '100%',
        padding: 20,
        borderRadius: 18,
        borderWidth: 1,
        gap: 12,
    },
    tokenInputLabel: { ...typography.tokenLabel },
    tokenInput: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        ...typography.tokenInput,
    },
    tokenBtnRow: { flexDirection: 'row', gap: 10 },
    cancelBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, justifyContent: 'center' },
    cancelBtnText: { ...typography.cancelBtn },

    // Active member screen
    activeBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        justifyContent: 'center',
    },
    activeBannerText: { ...typography.sectionLabel },
    calendarStrip: { borderBottomWidth: 1, paddingBottom: 2 },
    datesContainer: { gap: 10 },
    filterSection: { paddingHorizontal: 14, paddingTop: 8 },
    leaguesScroll: { paddingVertical: 4, gap: 8 },
    leagueChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: themeColors.border },
    leagueChipText: { ...typography.chipText },
    content: { flex: 1 },
    scrollContent: { padding: 14, paddingTop: 14, paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 6 },
    sectionTitle: { ...typography.sectionTitle },
    loadingContainer: { paddingVertical: 60, alignItems: 'center' },
    fixtureGrid: { gap: 8 },
    emptyContainer: { paddingVertical: 60, alignItems: 'center', gap: 14 },
    emptyIconWrapper: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
    emptyText: { ...typography.emptyText },
    emptySubtext: { ...typography.emptySubtext, textAlign: 'center', paddingHorizontal: 36 },
    });
}
