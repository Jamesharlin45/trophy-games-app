import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { DollarSign, Zap, CheckCircle2, Clock, Send, Key, MessageCircle } from 'lucide-react-native';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { MatchSectionList } from '../../components/neon/MatchSectionList';
import { DatePickerStrip } from '../../components/DatePickerStrip';
import { EmailRequestDialog, type EmailSubmitResult } from '../../components/EmailRequestDialog';
import { RequestSentDialog } from '../../components/RequestSentDialog';
import { SkeletonList } from '../../components/Skeleton';
import { NeonButton } from '../../components/neon/NeonButton';
import { onColor, readableAccent } from '../../components/neon/tokens';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { useUser } from '../../context/UserContext';
import { useDialog } from '../../context/DialogContext';
import { typography } from '../../theme/typography';
import { api } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';
import { safeString } from '../../utils/safeData';
import { getDeviceId } from '../../utils/deviceId';
import { getRequestEmail, saveRequestEmail } from '../../utils/requestEmail';
import { joinTelegram } from '../../lib/telegram';
import { withErrorBoundary } from '../../components/ScreenErrorBoundary';
import { useRouter } from 'expo-router';
import i18n, { tArray } from '../../locales';

type MemberStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'active' | 'loading';

const toTitleCase = (str: string) =>
    str.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const isAlreadyPendingReason = (reason: string | undefined): boolean =>
    typeof reason === 'string' && reason.toLowerCase().includes('already pending');

function PaidTipsScreen() {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accent = readableAccent(themeColors);
    const orange = onColor(themeColors.orange9);
    const router = useRouter();
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedLeague, setSelectedLeague] = useState('All');
    const [tokenInput, setTokenInput] = useState('');
    const [enteringToken, setEnteringToken] = useState(false);
    const [verifyingToken, setVerifyingToken] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [deviceId, setDeviceId] = useState('');
    const [emailDialogVisible, setEmailDialogVisible] = useState(false);
    const [sentDialogVisible, setSentDialogVisible] = useState(false);
    const [savedEmail, setSavedEmail] = useState('');
    const { username } = useUser();
    const { showEmailRequest } = useDialog();

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

    /** Submit the request with the address collected by the email dialog. */
    const submitMembershipRequest = async (email: string) => {
        if (!deviceId) return { ok: false, error: i18n.t('paid.error') };
        setRequesting(true);
        try {
            const result = await api.tokens.createMembershipRequest(
                deviceId,
                'paid',
                username || undefined,
                email,
            );
            if (!result.success) {
                return { ok: false, error: result.reason || i18n.t('paid.requestFailed') };
            }
            Alert.alert(i18n.t('paid.requestSentTitle'), i18n.t('paid.requestSentBody'));
            await refetchMembership();
            return { ok: true };
        } catch {
            return { ok: false, error: i18n.t('paid.requestFailed') };
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
            submitLabel: i18n.t('paid.requestBtn'),
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
                Alert.alert(i18n.t('paid.accessGranted'), i18n.t('paid.welcomePremium'));
                await refetchMembership();
            } else {
                Alert.alert(i18n.t('paid.invalidToken'), result.reason || i18n.t('paid.tokenInvalidMsg'));
            }
        } catch {
            Alert.alert(i18n.t('paid.error'), i18n.t('paid.tokenFailed'));
        }
        setVerifyingToken(false);
    };

    if (memberStatus === 'loading') {
        return (
            <View style={[styles.container, { backgroundColor: themeColors.background, justifyContent: 'center' }]}>
                <SkeletonList style={styles.skeletonList} />
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
                        <DollarSign size={16} color={onColor(themeColors.orange9)} />
                        <Text style={styles.gateBadgeText}>{i18n.t('paid.gateBadge')}</Text>
                    </View>

                    <Text style={[styles.gateTitle, { color: themeColors.text }]}>{i18n.t('paid.title')}</Text>
                    <Text style={[styles.gateSubtitle, { color: themeColors.mutedText }]}>
                        {i18n.t('paid.subtitle')}
                    </Text>

                    {tArray('paid.features').map((f, i) => (
                        <View key={i} style={styles.featureRow}>
                            <CheckCircle2 size={13} color={orange} />
                            <Text style={[styles.featureText, { color: themeColors.text }]}>{f}</Text>
                        </View>
                    ))}

                    {memberStatus === 'none' && !enteringToken && (
                        <NeonButton style={styles.primaryBtn} color={themeColors.orange9} onPress={askForEmail} disabled={requesting} accessibilityRole="button">
                            {requesting ? <Text style={styles.orangeBtnText}>{i18n.t('common.checking')}</Text> : (
                                <>
                                    <Send size={15} color={onColor(themeColors.orange9)} />
                                    <Text style={styles.orangeBtnText}>{i18n.t('paid.requestBtn')}</Text>
                                </>
                            )}
                        </NeonButton>
                    )}

                    {memberStatus === 'pending' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.surface, borderColor: themeColors.orange9 }]}>
                            <Clock size={18} color={orange} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>{i18n.t('paid.pendingTitle')}</Text>
                            <Text style={[styles.pendingText, { color: themeColors.mutedText }]}>
                                {i18n.t('paid.pendingBody')}
                            </Text>
                        </View>
                    )}

                    {memberStatus === 'approved' && !enteringToken && (
                        <View style={[styles.pendingCard, { backgroundColor: themeColors.surface, borderColor: themeColors.success }]}>
                            <CheckCircle2 size={18} color={themeColors.success} />
                            <Text style={[styles.pendingTitle, { color: themeColors.text }]}>{i18n.t('paid.approvedTitle')}</Text>
                            <Text style={[styles.pendingText, { color: themeColors.mutedText }]}>
                                {i18n.t('paid.approvedBody')}
                            </Text>
                        </View>
                    )}

                    {/* Get Premium access - navigate to Store tab */}
                    <NeonButton style={styles.primaryBtn} onPress={() => router.push('/market')} accessibilityRole="button">
                        <Text style={styles.primaryBtnText}>{i18n.t('paid.getAccess')}</Text>
                    </NeonButton>

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
                                accessibilityRole="button"
                            >
                                <MessageCircle size={14} color={themeColors.textMuted} />
                                <Text style={[styles.telegramText, { color: themeColors.textMuted }]}>TELEGRAM</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={[styles.tokenInputCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
                            <Text style={[styles.tokenInputLabel, { color: themeColors.mutedText }]}>{i18n.t('paid.tokenLabel')}</Text>
                            <TextInput
                                value={tokenInput}
                                onChangeText={setTokenInput}
                                placeholder={i18n.t('paid.tokenPlaceholder')}
                                placeholderTextColor={themeColors.mutedText}
                                style={[styles.tokenInput, { color: themeColors.text, borderColor: themeColors.border, backgroundColor: themeColors.surfaceElevated }]}
                                autoCapitalize="characters"
                                autoCorrect={false}
                            />
                            <View style={styles.tokenBtnRow}>
                                <NeonButton
                                    style={[styles.primaryBtn, styles.tokenActionBtn]}
                                    color={themeColors.orange9}
                                    onPress={verifyToken}
                                    disabled={verifyingToken || !tokenInput.trim()}
                                    accessibilityRole="button"
                                >
                                    {verifyingToken
                                        ? <Text style={styles.orangeBtnText}>{i18n.t('common.verifying')}</Text>
                                        : <Text style={styles.orangeBtnText}>{i18n.t('paid.verifyBtn')}</Text>
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
            <View style={[styles.calendarStrip, { borderBottomColor: themeColors.border }]}>
                <DatePickerStrip
                    dates={dates}
                    selectedDate={selectedDate}
                    onSelectDate={(date) => setSelectedDate(date)}
                />
            </View>

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

            <View style={[styles.activeBanner, { backgroundColor: `${themeColors.orange9}15`, borderBottomColor: `${themeColors.orange9}30` }]}>
                <DollarSign size={13} color={orange} />
                <Text style={[styles.activeBannerText, { color: orange }]}>{i18n.t('paid.activeBanner')}</Text>
            </View>

            {loading ? (
                <SkeletonList style={styles.scrollContent} />
            ) : filteredMatches.length > 0 ? (
                <MatchSectionList
                    matches={filteredMatches}
                    access={{ paid: memberStatus === 'active', vip: false }}
                    style={styles.content}
                    contentContainerStyle={styles.scrollContent}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
                    ListHeaderComponent={
                        <View style={styles.sectionHeader}>
                            <Zap size={14} color={orange} />
                            <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{i18n.t('paid.sectionTitle')}</Text>
                        </View>
                    }
                />
            ) : (
                <ScrollView contentContainerStyle={styles.emptyContainer}>
                    <View style={[styles.emptyIconWrapper, { backgroundColor: themeColors.surfaceElevated }]}>
                        <DollarSign size={36} color={themeColors.mutedText} />
                    </View>
                    <Text style={[styles.emptyText, { color: themeColors.text }]}>{i18n.t('paid.emptyTitle')}</Text>
                    <Text style={[styles.emptySubtext, { color: themeColors.mutedText }]}>
                        {i18n.t('paid.emptySub')}
                    </Text>
                </ScrollView>
            )}
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
    container: { flex: 1 },
    gateContainer: { padding: 28, paddingTop: 48, alignItems: 'center', gap: 16, paddingBottom: 100 },
    gateBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, marginBottom: 4 },
    gateBadgeText: { ...typography.gateBadge, color: onColor(themeColors.orange9) },
    gateTitle: { ...typography.gateTitle },
    gateSubtitle: { ...typography.gateSubtitle, textAlign: 'center', paddingHorizontal: 16 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', width: '100%', paddingHorizontal: 8 },
    featureText: { ...typography.featureText },
    primaryBtn: { borderRadius: 16, width: '100%', marginTop: 8, minHeight: 52 },
    tokenActionBtn: { flex: 1, marginTop: 0 },
    primaryBtnText: { ...typography.primaryBtn, color: themeColors.accentText },
    orangeBtnText: { ...typography.primaryBtn, color: onColor(themeColors.orange9) },
    secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, width: '100%', borderWidth: 1, minHeight: 48 },
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
    cancelBtn: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, justifyContent: 'center', minHeight: 48 },
    cancelBtnText: { ...typography.cancelBtn },
    activeBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, justifyContent: 'center' },
    activeBannerText: { ...typography.sectionLabel },
    calendarStrip: { borderBottomWidth: 1, paddingBottom: 2 },
    filterSection: { paddingHorizontal: 14, paddingTop: 8 },
    leaguesScroll: { paddingVertical: 4, gap: 8 },
    leagueChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: themeColors.border },
    leagueChipText: { ...typography.chipText },
    content: { flex: 1 },
    scrollContent: { padding: 14, paddingTop: 14, paddingBottom: 40 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
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

export default withErrorBoundary(PaidTipsScreen);
