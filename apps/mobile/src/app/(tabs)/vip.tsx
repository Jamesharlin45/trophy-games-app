import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Crown, Key, CheckCircle2, Clock, Send } from 'lucide-react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { MatchSectionList } from '../../components/neon/MatchSectionList';
import { DatePickerStrip } from '../../components/DatePickerStrip';
import { SkeletonList } from '../../components/Skeleton';
import { NeonButton } from '../../components/neon/NeonButton';
import { readableAccent } from '../../components/neon/tokens';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { useUser } from '../../context/UserContext';
import { useDialog } from '../../context/DialogContext';
import { typography } from '../../theme/typography';
import { api } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';
import { useRouter } from 'expo-router';
import * as Application from 'expo-application';
import i18n, { tArray } from '../../locales';

type MemberStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'active' | 'loading';

const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export default function VIPTipsScreen() {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accent = readableAccent(themeColors);
    const router = useRouter();
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedLeague, setSelectedLeague] = useState('All');
    const [tokenInput, setTokenInput] = useState('');
    const [enteringToken, setEnteringToken] = useState(false);
    const [verifyingToken, setVerifyingToken] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [deviceId, setDeviceId] = useState('');
    const { username } = useUser();
    const { showEmailRequest } = useDialog();

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

    const matches = useMemo(() => matchesData ?? [], [matchesData]);
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

    /** Submit the request with the address collected by the email dialog. */
    const submitMembershipRequest = async (email: string) => {
        if (!deviceId) return { ok: false, error: i18n.t('vip.error') };
        setRequesting(true);
        try {
            const result = await api.tokens.createMembershipRequest(
                deviceId,
                'vip',
                username || undefined,
                email,
            );
            if (!result.success) {
                return { ok: false, error: result.reason || i18n.t('vip.requestFailed') };
            }
            Alert.alert(i18n.t('vip.requestSentTitle'), i18n.t('vip.requestSentBody'));
            await refetchMembership();
            return { ok: true };
        } catch {
            return { ok: false, error: i18n.t('vip.requestFailed') };
        } finally {
            setRequesting(false);
        }
    };

    const askForEmail = () => {
        if (!deviceId) return;
        showEmailRequest({
            title: i18n.t('emailRequest.manualTitle'),
            subtitle: i18n.t('emailRequest.manualBody'),
            note: i18n.t('emailRequest.manualNote'),
            submitLabel: i18n.t('vip.requestBtn'),
            onSubmit: submitMembershipRequest,
        });
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
                Alert.alert(i18n.t('vip.accessGranted'), i18n.t('vip.welcomeVip'));
                await refetchMembership();
            } else {
                Alert.alert(i18n.t('vip.invalidToken'), result.reason || i18n.t('vip.tokenInvalidMsg'));
            }
        } catch {
            Alert.alert(i18n.t('vip.error'), i18n.t('vip.tokenFailed'));
        }
        setVerifyingToken(false);
    };

    // ---- Gate: loading membership ----
    if (memberStatus === 'loading') {
        return (
            <View style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center' }]}>
                <SkeletonList style={styles.skeletonList} />
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
                        <Crown size={18} color={themeColors.accentText} />
                        <Text style={styles.gateBadgeText}>{i18n.t('vip.gateBadge')}</Text>
                    </View>

                    <Text style={[styles.gateTitle, { color: themeColors.text }]}>{i18n.t('vip.title')}</Text>
                    <Text style={[styles.gateSubtitle, { color: themeColors.mutedText }]}>
                        {i18n.t('vip.subtitle')}
                    </Text>

                    {tArray('vip.features').map((f, i) => (
                        <View key={i} style={styles.featureRow}>
                            <CheckCircle2 size={14} color={accent} />
                            <Text style={[styles.featureText, { color: themeColors.text }]}>{f}</Text>
                        </View>
                    ))}

                    {memberStatus === 'none' && !enteringToken && (
                        <NeonButton style={styles.primaryBtn} onPress={askForEmail} disabled={requesting} accessibilityRole="button">
                            {requesting ? <Text style={styles.primaryBtnText}>{i18n.t('common.checking')}</Text> : (
                                <>
                                    <Send size={16} color={themeColors.accentText} />
                                    <Text style={styles.primaryBtnText}>{i18n.t('vip.requestBtn')}</Text>
                                </>
                            )}
                        </NeonButton>
                    )}

                    {memberStatus === 'pending' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.surface, borderColor: themeColors.accent }]}>
                            <Clock size={20} color={accent} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>{i18n.t('vip.pendingTitle')}</Text>
                            <Text style={[styles.pendingText, { color: themeColors.mutedText }]}>
                                {i18n.t('vip.pendingBody')}
                            </Text>
                        </View>
                    )}

                    {memberStatus === 'approved' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.surface, borderColor: themeColors.success }]}>
                            <CheckCircle2 size={20} color={themeColors.success} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>{i18n.t('vip.approvedTitle')}</Text>
                            <Text style={[styles.pendingText, { color: themeColors.mutedText }]}>
                                {i18n.t('vip.approvedBody')}
                            </Text>
                        </View>
                    )}

                    {/* Get VIP access - navigate to Store tab */}
                    <NeonButton style={styles.primaryBtn} onPress={() => router.push('/market')} accessibilityRole="button">
                        <Text style={styles.primaryBtnText}>{i18n.t('vip.getAccess')}</Text>
                    </NeonButton>

                    {/* Enter token */}
                    {!enteringToken ? (
                        <TouchableOpacity
                            style={[styles.secondaryBtn, { borderColor: themeColors.border }]}
                            onPress={() => setEnteringToken(true)}
                            accessibilityRole="button"
                        >
                            <Key size={14} color={themeColors.mutedText} />
                            <Text style={[styles.secondaryBtnText, { color: themeColors.mutedText }]}>{i18n.t('vip.tokenBtn')}</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={[styles.tokenInputCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
                            <Text style={[styles.tokenInputLabel, { color: themeColors.mutedText }]}>{i18n.t('vip.tokenLabel')}</Text>
                            <TextInput
                                value={tokenInput}
                                onChangeText={setTokenInput}
                                placeholder={i18n.t('vip.tokenPlaceholder')}
                                placeholderTextColor={themeColors.mutedText}
                                style={[styles.tokenInput, { color: themeColors.text, borderColor: themeColors.border, backgroundColor: themeColors.surfaceElevated }]}
                                autoCapitalize="characters"
                                autoCorrect={false}
                            />
                            <View style={styles.tokenBtnRow}>
                                <NeonButton
                                    style={[styles.primaryBtn, styles.tokenActionBtn]}
                                    onPress={verifyToken}
                                    disabled={verifyingToken || !tokenInput.trim()}
                                    accessibilityRole="button"
                                >
                                    {verifyingToken
                                        ? <Text style={styles.primaryBtnText}>{i18n.t('common.verifying')}</Text>
                                        : <Text style={styles.primaryBtnText}>{i18n.t('vip.verifyBtn')}</Text>
                                    }
                                </NeonButton>
                                <TouchableOpacity
                                    style={[styles.cancelBtn, { backgroundColor: themeColors.surfaceElevated }]}
                                    onPress={() => { setEnteringToken(false); setTokenInput(''); }}
                                    accessibilityRole="button"
                                >
                                    <Text style={[styles.cancelBtnText, { color: themeColors.mutedText }]}>{i18n.t('common.cancel')}</Text>
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
                    onSelectDate={(date) => setSelectedDate(date)}
                />
            </View>

            {/* League filter */}
            <View style={styles.filterSection}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.leaguesScroll}>
                    {uniqueLeagues.map((league) => (
                        <TouchableOpacity
                            key={league}
                            onPress={() => setSelectedLeague(league)}
                            style={[
                                styles.leagueChip,
                                { backgroundColor: selectedLeague === league ? themeColors.accent : themeColors.surfaceElevated },
                            ]}
                        >
                            <Text style={[styles.leagueChipText, { color: selectedLeague === league ? themeColors.accentText : themeColors.mutedText }]}>
                                {league === 'All' ? i18n.t('common.all') : toTitleCase(league)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* VIP active badge */}
            <View style={[styles.activeBanner, { backgroundColor: themeColors.glass, borderColor: themeColors.accent }]}>
                <Crown size={14} color={accent} />
                <Text style={[styles.activeBannerText, { color: accent }]}>{i18n.t('vip.activeBanner')}</Text>
            </View>

            {loading ? (
                <SkeletonList style={styles.scrollContent} />
            ) : filteredMatches.length > 0 ? (
                <MatchSectionList
                    matches={filteredMatches}
                    access={{ paid: false, vip: memberStatus === 'active' }}
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
                    ListHeaderComponent={
                        <View style={styles.sectionHeader}>
                            <Crown size={14} color={accent} />
                            <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{i18n.t('vip.sectionTitle')}</Text>
                        </View>
                    }
                />
            ) : (
                <ScrollView contentContainerStyle={styles.emptyContainer}>
                    <View style={[styles.emptyIconWrapper, { backgroundColor: themeColors.surfaceElevated }]}>
                        <Crown size={36} color={themeColors.mutedText} />
                    </View>
                    <Text style={[styles.emptyText, { color: themeColors.text }]}>{i18n.t('vip.emptyTitle')}</Text>
                    <Text style={[styles.emptySubtext, { color: themeColors.mutedText }]}>
                        {i18n.t('vip.emptySub')}
                    </Text>
                </ScrollView>
            )}
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
    container: { flex: 1 },

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
    gateBadgeText: { ...typography.gateBadge, color: themeColors.accentText },
    gateTitle: { ...typography.gateTitle },
    gateSubtitle: { ...typography.gateSubtitle, textAlign: 'center', paddingHorizontal: 16 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', width: '100%', paddingHorizontal: 8 },
    featureText: { ...typography.featureText },
    primaryBtn: {
        borderRadius: 16,
        width: '100%',
        marginTop: 8,
        minHeight: 52,
    },
    tokenActionBtn: {
        flex: 1,
        marginTop: 0,
    },
    primaryBtnText: { ...typography.primaryBtn, color: themeColors.accentText },
    secondaryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 13,
        borderRadius: 14,
        width: '100%',
        borderWidth: 1,
        minHeight: 48,
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
    cancelBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, justifyContent: 'center', minHeight: 48 },
    cancelBtnText: { ...typography.cancelBtn },

    // Active member screen
    activeBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    activeBannerText: { ...typography.sectionLabel },
    calendarStrip: { borderBottomWidth: 1, paddingBottom: 2 },
    filterSection: { paddingHorizontal: 14, paddingTop: 8 },
    leaguesScroll: { paddingVertical: 4, gap: 8 },
    leagueChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: themeColors.border },
    leagueChipText: { ...typography.chipText },
    content: { flex: 1 },
    scrollContent: { padding: 14, paddingTop: 14, paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 6 },
    sectionTitle: { ...typography.sectionTitle },
    skeletonList: { padding: 8, width: '100%' },
    loadingContainer: { paddingVertical: 60, alignItems: 'center' },
    fixtureGrid: { gap: 8 },
    emptyContainer: { paddingVertical: 60, alignItems: 'center', gap: 14 },
    emptyIconWrapper: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
    emptyText: { ...typography.emptyText },
    emptySubtext: { ...typography.emptySubtext, textAlign: 'center', paddingHorizontal: 36 },
    });
}
