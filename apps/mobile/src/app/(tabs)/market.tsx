import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert, Platform } from 'react-native';
import { Crown, CheckCircle2, Zap, Trophy, ShieldCheck, CreditCard, Sparkles, Key, Clock, ShoppingCart, Send } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { useUser } from '../../context/UserContext';
import { useDialog } from '../../context/DialogContext';
import { typography } from '../../theme/typography';
import { SUBSCRIPTION_PRODUCTS, getTierForProduct } from '@trophy-games/shared/subscriptions';
import { useIap, ProductSubscription } from '../../hooks/useIap';
import { useNoConnectionDialog } from '../../hooks/useNoConnectionDialog';
import { purchaseFlow } from '../../utils/purchaseFlow';
import { planTitleFor } from '../../utils/planTitle';
import * as Application from 'expo-application';
import { api } from '../../api/client';
import { useScreenQuery } from '../../hooks/useLiveQuery';
import { NeonButton } from '../../components/neon/NeonButton';
import { readableAccent, readableOnSurface } from '../../components/neon/tokens';
import { EmailTokenModal } from '../../components/EmailTokenModal';
import i18n, { tArray } from '../../locales';

type MemberStatus = 'none' | 'pending' | 'approved' | 'active' | 'loading';

export default function MembershipStoreScreen() {
    const { themeColors, isDark } = useTheme();
    const styles = getStyles(themeColors);
    const accent = readableAccent(themeColors, isDark);
    const [refreshing, setRefreshing] = useState(false);
    const [deviceId, setDeviceId] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const [showTokenInput, setShowTokenInput] = useState(false);
    const [verifyingToken, setVerifyingToken] = useState(false);
    const [requesting, setRequesting] = useState<string | null>(null);
    const [purchasing, setPurchasing] = useState<string | null>(null);

    const { plan } = useLocalSearchParams<{ plan?: string }>();
    const { active, showPurchaseSuccess, showPurchaseFailed, showEmailRequest, joinTelegram } = useDialog();
    const scrollRef = useRef<ScrollView>(null);
    const planOffsetsRef = useRef<Record<string, number>>({});
    const contentTopRef = useRef(0);
    const [highlightPlan, setHighlightPlan] = useState<string | null>(null);
    const purchaseRetryRef = useRef<() => void>(() => {});

    // After a successful purchase: show the "email my token" modal; if the
    // user skips it, show a banner that reopens the modal.
    const [emailModal, setEmailModal] = useState<{ deviceId: string; purchaseToken: string } | null>(null);
    const [emailPurchase, setEmailPurchase] = useState<{ deviceId: string; purchaseToken: string } | null>(null);
    const [emailBannerShown, setEmailBannerShown] = useState(false);

    const { username } = useUser();

    // ── IAP hook (Google Play Billing) ──
    const {
        products: iapProducts,
        activeSubscription: iapActiveSub,
        loading: iapLoading,
        error: iapError,
        purchase: iapPurchase,
        refresh: iapRefresh,
    } = useIap({
        deviceId,
        onPurchaseSuccess: async (_tier: 'vip' | 'paid', purchaseToken: string, productId: string) => {
            try {
                const result = await api.purchases.recordPurchase({
                    deviceId,
                    productId,
                    purchaseToken,
                });
                if (result.success) {
                    const tier = result.alreadyRecorded
                        ? (getTierForProduct(productId) ?? _tier)
                        : result.tier;
                    let expiresAt = result.alreadyRecorded ? undefined : result.expiresAt;
                    if (result.alreadyRecorded) {
                        try {
                            const active = await api.purchases.getActiveSubscription(deviceId);
                            if (active?.productId === productId) expiresAt = active.expiresAt;
                        } catch {
                            // Optional — the dialog still works without a date.
                        }
                    }
                    showPurchaseSuccess({ tier, planTitle: planTitleFor(productId), expiresAt });
                    if (deviceId) {
                        const info = { deviceId, purchaseToken };
                        setEmailPurchase(info);
                        setEmailModal(info);
                        setEmailBannerShown(false);
                    }
                } else {
                    showPurchaseFailed({ message: result.reason || i18n.t('market.purchaseActivateBody') });
                }
            } catch (e) {
                showPurchaseFailed({
                    message: e instanceof Error ? e.message : i18n.t('market.subscribeErrorBody'),
                });
            }
        },
        onPurchaseError: (msg: string) => {
            showPurchaseFailed({ message: msg, onRetry: () => purchaseRetryRef.current() });
        },
    });

    // Get device ID on mount
    useEffect(() => {
        const id = Application.applicationId + '_' + (Application.nativeApplicationVersion || 'v1');
        setDeviceId(id);
    }, []);

    // Membership status for each tier.
    const {
        data: vipStatusData,
        error: vipError,
        loaded: vipLoaded,
        refetch: refetchVip,
    } = useScreenQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'vip', username || undefined),
        [deviceId, username],
        { enabled: Boolean(deviceId) },
    );
    const {
        data: paidStatusData,
        error: paidError,
        loaded: paidLoaded,
        refetch: refetchPaid,
    } = useScreenQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'paid', username || undefined),
        [deviceId, username],
        { enabled: Boolean(deviceId) },
    );

    // Map API status to local status
    const getLocalStatus = (
        data: typeof vipStatusData,
        loaded: boolean,
    ): MemberStatus => {
        if (!loaded) return 'loading';
        if (!data) return 'none';
        if (data.status === 'active') return 'active';
        if (data.status === 'pending') return 'pending';
        if (data.status === 'approved') return 'approved';
        return 'none';
    };

    const vipTokenStatus = getLocalStatus(vipStatusData, vipLoaded);
    const paidTokenStatus = getLocalStatus(paidStatusData, paidLoaded);

    // Status priority: real IAP purchase > manually granted access.
    // If Google Play is connected but there is no active matching subscription,
    // keep the user's manually issued/pending/approved access visible instead of hiding it as `none`.

    // VIP status is shared across weekly and monthly (same tier)
    const vipStatus: MemberStatus = iapActiveSub?.tier === 'vip'
        ? 'active'
        : vipTokenStatus;
    const paidStatus: MemberStatus = iapActiveSub?.tier === 'paid'
        ? 'active'
        : paidTokenStatus;

    const retryConnection = useCallback(async (): Promise<boolean> => {
        try {
            await Promise.all([
                api.tokens.getMembershipStatus(deviceId, 'vip', username || undefined),
                api.tokens.getMembershipStatus(deviceId, 'paid', username || undefined),
            ]);
            await Promise.all([refetchVip(), refetchPaid(), iapRefresh()]);
            return true;
        } catch {
            return false;
        }
    }, [deviceId, username, refetchVip, refetchPaid, iapRefresh]);

    const connection = useNoConnectionDialog(vipError ?? paidError, retryConnection);

    const onRefresh = useCallback(async () => {
        connection.arm();
        setRefreshing(true);
        await Promise.all([refetchVip(), refetchPaid(), iapRefresh()]);
        setRefreshing(false);
    }, [connection, refetchVip, refetchPaid, iapRefresh]);

    /** Submit the manual request with the address collected by the email dialog. */
    const submitManualRequest = async (type: 'vip' | 'paid', email: string) => {
        if (!deviceId) return { ok: false, error: i18n.t('market.requestFailed') };
        setRequesting(type);
        try {
            const result = await api.tokens.requestMembership(
                deviceId,
                type,
                username || undefined,
                email,
            );
            if (!result.success) {
                return { ok: false, error: result.reason || i18n.t('market.requestFailed') };
            }
            Alert.alert(i18n.t('market.requestSuccessTitle'), i18n.t('market.requestSuccessBody', { type: type.toUpperCase() }));
            return { ok: true };
        } catch {
            return { ok: false, error: i18n.t('market.requestErrorBody') };
        } finally {
            setRequesting(null);
        }
    };

    const askForEmail = (type: 'vip' | 'paid') => {
        if (!deviceId) return;
        showEmailRequest({
            title: i18n.t('emailRequest.manualTitle'),
            subtitle: i18n.t('emailRequest.manualBody'),
            note: i18n.t('emailRequest.manualNote'),
            submitLabel: i18n.t('market.requestTokenBtn'),
            onSubmit: (email: string) => submitManualRequest(type, email),
        });
    };

    const handleVerifyToken = async () => {
        if (!tokenInput.trim() || !deviceId) return;
        setVerifyingToken(true);
        try {
            const result = await api.tokens.verifyToken(
                tokenInput.trim(),
                deviceId,
                username || undefined,
            );
            if (result.valid) {
                Alert.alert(i18n.t('market.verifySuccessTitle'), i18n.t('market.verifySuccessBody'));
                setShowTokenInput(false);
                setTokenInput('');
                await Promise.all([refetchVip(), refetchPaid()]);
            } else {
                Alert.alert(i18n.t('market.verifyInvalidTitle'), result.reason || i18n.t('market.verifyInvalidBody'));
            }
        } catch {
            Alert.alert(i18n.t('market.verifyErrorTitle'), i18n.t('market.verifyErrorBody'));
        }
        setVerifyingToken(false);
    };

    /** Handle Google Play subscription purchase */
    const handleSubscribe = async (productId: string, _tier: 'vip' | 'paid') => {
        if (!deviceId) return;
        purchaseRetryRef.current = () => void handleSubscribe(productId, _tier);
        purchaseFlow.setBusy(true);
        setPurchasing(productId);
        try {
            const result = await iapPurchase(productId);
            if (!result.success && result.reason) {
                if (!result.reason.toLowerCase().includes('cancel')) {
                    showPurchaseFailed({
                        message: result.reason,
                        onRetry: () => purchaseRetryRef.current(),
                    });
                }
            }
            // On success, the onPurchaseSuccess callback above records the purchase.
        } catch (e) {
            const message = e instanceof Error ? e.message : i18n.t('market.subscribeErrorBody');
            showPurchaseFailed({ message, onRetry: () => purchaseRetryRef.current() });
        } finally {
            purchaseFlow.setBusy(false);
            setPurchasing(null);
        }
    };

    /** Find a Google Play product by exact product ID */
    const getProduct = (productId: string) =>
        iapProducts.find(p => p.id === productId);

    /** Format price string from v15 ProductSubscription */
    const formatPrice = (product: ProductSubscription | undefined): string | null => {
        if (!product) return null;
        return product.displayPrice || product.price || null;
    };

    // Individual product lookups — each card gets its own product
    const vipWeeklyProduct  = getProduct(SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId);
    const vipMonthlyProduct = getProduct(SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId);
    const paidMonthlyProduct = getProduct(SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId);

    // Active IAP product IDs for border highlighting
    const activeProductId = iapActiveSub?.productId ?? null;

    // When the subscription dialog sends us here with a plan, scroll to and
    // highlight that card.
    const scrollToPlan = useCallback((productId: string) => {
        const offset = contentTopRef.current + (planOffsetsRef.current[productId] ?? 0) - 24;
        scrollRef.current?.scrollTo({ y: Math.max(0, offset), animated: true });
    }, []);

    useEffect(() => {
        if (!plan) return;
        setHighlightPlan(plan);
        const timer = setTimeout(() => scrollToPlan(plan), 350);
        return () => clearTimeout(timer);
    }, [plan, scrollToPlan]);

    const StatusBadge = ({ status, iapActive }: { status: MemberStatus; iapActive: boolean }) => {
        if (status === 'none' || status === 'loading') return null;

        const config = iapActive
            ? { color: themeColors.success, icon: ShoppingCart, label: i18n.t('market.statusSubscribed') }
            : {
                pending: { color: themeColors.warning, icon: Clock, label: i18n.t('market.statusPending') },
                approved: { color: themeColors.success, icon: CheckCircle2, label: i18n.t('market.statusApproved') },
                active: { color: themeColors.accent, icon: Crown, label: i18n.t('market.statusActive') },
            }[status as 'pending' | 'approved' | 'active'];

        if (!config) return null;
        const displayColor = readableOnSurface(config.color, themeColors, isDark);

        return (
            <View style={[styles.statusPill, { backgroundColor: config.color + '20', borderColor: config.color + '40' }]}>
                <config.icon size={10} color={displayColor} />
                <Text style={[styles.statusText, { color: displayColor }]}>{config.label}</Text>
            </View>
        );
    };

    const isLoading = vipStatus === 'loading' || paidStatus === 'loading';

    // Helper: renders the action area for a subscription card
    const renderCardActions = (
        productId: string,
        product: ProductSubscription | undefined,
        status: MemberStatus,
        tier: 'vip' | 'paid',
        priceSuffix: string,
    ) => {
        if (isLoading) {
            return (
                <View style={styles.loadingRow}>
                    <View style={[styles.emptyBar, { backgroundColor: themeColors.surfaceElevated }]} />
                    <Text style={[styles.loadingText, { color: themeColors.mutedText }]}>{i18n.t('common.checking')}</Text>
                </View>
            );
        }
        if (status === 'none') {
            return (
                <View style={styles.actionGroup}>
                    <NeonButton
                        style={styles.subscribeBtn}
                        onPress={() => handleSubscribe(productId, tier)}
                        disabled={purchasing !== null || iapLoading}
                        accessibilityRole="button"
                    >
                        <ShoppingCart size={16} color={themeColors.accentText} />
                        <Text style={[styles.subscribeBtnText, { color: themeColors.accentText }]}>
                            {formatPrice(product)
                                ? `${formatPrice(product)}${priceSuffix}`
                                : i18n.t('market.subscribeBtn')}
                        </Text>
                    </NeonButton>
                    <TouchableOpacity
                        style={styles.textBtn}
                        onPress={() => askForEmail(tier)}
                        disabled={requesting === tier}
                        accessibilityRole="button"
                    >
                        <Text style={[styles.textBtnLabel, { color: themeColors.mutedText }]}>{i18n.t('market.requestTokenBtn')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        if (status === 'pending') {
            return (
                <View style={[styles.pendingInfo, { backgroundColor: themeColors.surfaceElevated }]}>
                    <Clock size={16} color={themeColors.mutedText} />
                    <Text style={[styles.pendingText, { color: themeColors.mutedText }]}>{i18n.t('market.reviewingBody')}</Text>
                </View>
            );
        }
        // active / approved
        return (
            <View style={[styles.activeInfo, { backgroundColor: themeColors.accent + '15' }]}>
                <CheckCircle2 size={16} color={accent} />
                <Text style={[styles.activeInfoText, { color: accent }]}>
                    {activeProductId === productId && iapActiveSub?.expiresAt
                        ? i18n.t('market.subscribedExpires', { date: new Date(iapActiveSub.expiresAt).toLocaleDateString() })
                        : i18n.t('market.accessActive')}
                </Text>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <ScrollView
                ref={scrollRef}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}
            >
                {/* Email banner: shown after the user skips the post-purchase modal */}
                {emailBannerShown && emailPurchase ? (
                    <View style={styles.emailBanner}>
                        <TouchableOpacity style={styles.emailBannerMain} onPress={() => setEmailModal(emailPurchase)} accessibilityRole="button">
                            <Text style={[styles.emailBannerText, { color: themeColors.text }]}>
                                {i18n.t('market.emailBanner')}
                            </Text>
                            <Key size={16} color={accent} />
                        </TouchableOpacity>
                    </View>
                ) : null}

                {/* Hero section */}
                <View style={[styles.hero, { backgroundColor: themeColors.surface, borderColor: themeColors.border, borderWidth: 1 }]}>
                    <View style={styles.heroContent}>
                        <View style={[styles.heroBadge, { backgroundColor: themeColors.accent + '20' }]}>
                            <Sparkles size={14} color={accent} />
                            <Text style={[styles.heroBadgeText, { color: accent }]}>{i18n.t('market.heroBadge')}</Text>
                        </View>
                        <Text style={[styles.heroTitle, { color: themeColors.text }]}>{i18n.t('market.heroTitle')}</Text>
                        <Text style={[styles.heroSubtitle, { color: themeColors.mutedText }]}>
                            {i18n.t('market.heroSubtitle')}
                        </Text>
                    </View>
                </View>

                <View
                    style={styles.content}
                    onLayout={(event) => {
                        contentTopRef.current = event.nativeEvent.layout.y;
                    }}
                >
                    {/* Token Input Section (if approved) */}
                    {(vipTokenStatus === 'approved' || paidTokenStatus === 'approved' || showTokenInput) && (
                        <View style={[styles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.accent, borderWidth: 2 }]}>
                            <View style={styles.cardHeader}>
                                <Key size={20} color={accent} />
                                <Text style={[styles.cardTitle, { color: themeColors.text }]}>{i18n.t('market.tokenTitle')}</Text>
                            </View>
                            <TextInput
                                style={[styles.input, { backgroundColor: themeColors.surfaceElevated, color: themeColors.text, borderColor: themeColors.border }]}
                                placeholder={i18n.t('market.tokenPlaceholder')}
                                placeholderTextColor={themeColors.mutedText}
                                value={tokenInput}
                                onChangeText={setTokenInput}
                                autoCapitalize="characters"
                            />
                            <NeonButton
                                style={styles.actionBtn}
                                onPress={handleVerifyToken}
                                disabled={verifyingToken || !tokenInput.trim()}
                                accessibilityRole="button"
                            >
                                <Text style={[styles.actionBtnText, { color: themeColors.accentText }]}>{i18n.t('market.activateBtn')}</Text>
                            </NeonButton>
                        </View>
                    )}

                    {/* IAP status banner */}
                    {iapError && Platform.OS === 'android' && !iapLoading && (
                        <View style={[styles.iapNotice, { backgroundColor: themeColors.surfaceElevated, borderColor: themeColors.border }]}>
                            <Text style={[styles.iapNoticeText, { color: themeColors.mutedText }]}>
                                {i18n.t('market.iapNotice', { error: iapError.includes('not available') ? i18n.t('market.iapNoticeUnavailable') : iapError })}
                            </Text>
                        </View>
                    )}

                    {/* MEMBERSHIP PLANS */}
                    <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{i18n.t('market.sectionTitle')}</Text>

                    {/* ── VIP WEEKLY CARD ── */}
                    <View
                        style={[
                            styles.card,
                            { borderColor: activeProductId === SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId ? themeColors.accent + '60' : themeColors.border },
                            highlightPlan === SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId && styles.highlightedCard,
                        ]}
                        onLayout={(event) => {
                            planOffsetsRef.current[SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId] = event.nativeEvent.layout.y;
                        }}
                    >
                        <View style={styles.cardTop}>
                            <View style={styles.cardHeader}>
                                <Crown size={24} color={accent} />
                                <View>
                                    <Text style={[styles.planTitle, { color: themeColors.text }]}>{i18n.t('market.vipWeeklyTitle')}</Text>
                                    <Text style={[styles.planSubtitle, { color: themeColors.mutedText }]}>{i18n.t('market.vipWeeklySubtitle')}</Text>
                                </View>
                            </View>
                            <StatusBadge
                                status={vipStatus}
                                iapActive={activeProductId === SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId}
                            />
                        </View>
                        <View style={styles.features}>
                            {tArray('market.vipWeeklyFeatures').map((f, i) => (
                                <View key={i} style={styles.featureLine}>
                                    <ShieldCheck size={14} color={accent} />
                                    <Text style={[styles.featureText, { color: themeColors.text }]}>{f}</Text>
                                </View>
                            ))}
                        </View>
                        {renderCardActions(
                            SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId,
                            vipWeeklyProduct,
                            vipStatus,
                            'vip',
                            '/week',
                        )}
                    </View>

                    {/* ── VIP MONTHLY CARD ── */}
                    <View
                        style={[
                            styles.card,
                            { borderColor: activeProductId === SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId ? themeColors.accent + '60' : themeColors.border },
                            highlightPlan === SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId && styles.highlightedCard,
                        ]}
                        onLayout={(event) => {
                            planOffsetsRef.current[SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId] = event.nativeEvent.layout.y;
                        }}
                    >
                        <View style={styles.cardTop}>
                            <View style={styles.cardHeader}>
                                <Crown size={24} color={accent} />
                                <View>
                                    <Text style={[styles.planTitle, { color: themeColors.text }]}>{i18n.t('market.vipMonthlyTitle')}</Text>
                                    <Text style={[styles.planSubtitle, { color: themeColors.mutedText }]}>{i18n.t('market.vipMonthlySubtitle')}</Text>
                                </View>
                            </View>
                            <StatusBadge
                                status={vipStatus}
                                iapActive={activeProductId === SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId}
                            />
                        </View>
                        <View style={styles.features}>
                            {tArray('market.vipMonthlyFeatures').map((f, i) => (
                                <View key={i} style={styles.featureLine}>
                                    <ShieldCheck size={14} color={accent} />
                                    <Text style={[styles.featureText, { color: themeColors.text }]}>{f}</Text>
                                </View>
                            ))}
                        </View>
                        {/* Best value badge */}
                        <View style={[styles.savingsBadge, { backgroundColor: themeColors.accent + '15', borderColor: themeColors.accent + '30' }]}>
                            <Zap size={11} color={accent} />
                            <Text style={[styles.savingsText, { color: accent }]}>{i18n.t('market.bestValue')}</Text>
                        </View>
                        {renderCardActions(
                            SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId,
                            vipMonthlyProduct,
                            vipStatus,
                            'vip',
                            '/month',
                        )}
                    </View>

                    {/* ── PAID MONTHLY CARD ── */}
                    <View
                        style={[
                            styles.card,
                            { borderColor: activeProductId === SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId ? themeColors.accent + '60' : themeColors.border },
                            highlightPlan === SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId && styles.highlightedCard,
                        ]}
                        onLayout={(event) => {
                            planOffsetsRef.current[SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId] = event.nativeEvent.layout.y;
                        }}
                    >
                        <View style={styles.cardTop}>
                            <View style={styles.cardHeader}>
                                <Trophy size={24} color={accent} />
                                <View>
                                    <Text style={[styles.planTitle, { color: themeColors.text }]}>{i18n.t('market.paidMonthlyTitle')}</Text>
                                    <Text style={[styles.planSubtitle, { color: themeColors.mutedText }]}>{i18n.t('market.paidMonthlySubtitle')}</Text>
                                </View>
                            </View>
                            <StatusBadge
                                status={paidStatus}
                                iapActive={activeProductId === SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId}
                            />
                        </View>
                        <View style={styles.features}>
                            {tArray('market.paidMonthlyFeatures').map((f, i) => (
                                <View key={i} style={styles.featureLine}>
                                    <ShieldCheck size={14} color={accent} />
                                    <Text style={[styles.featureText, { color: themeColors.text }]}>{f}</Text>
                                </View>
                            ))}
                        </View>
                        {renderCardActions(
                            SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId,
                            paidMonthlyProduct,
                            paidStatus,
                            'paid',
                            '/month',
                        )}
                    </View>

                    {/* Support / Info */}
                    <View style={[styles.footer, { backgroundColor: themeColors.surfaceElevated }]}>
                        <InfoSection icon={ShieldCheck} title={i18n.t('market.infoTitle1')} desc={i18n.t('market.infoDesc1')} />
                        <View style={styles.divider} />
                        <InfoSection icon={CreditCard} title={i18n.t('market.infoTitle2')} desc={i18n.t('market.infoDesc2')} />
                    </View>

                    {/* Telegram invite */}
                    <TouchableOpacity
                        style={styles.telegramRow}
                        onPress={() => void joinTelegram()}
                        accessibilityRole="link"
                        accessibilityLabel={i18n.t('market.telegramRow')}
                        activeOpacity={0.7}
                    >
                        <Send size={15} color={accent} />
                        <Text style={[styles.telegramText, { color: themeColors.mutedText }]}>
                            {i18n.t('market.telegramRow')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            {/* Post-purchase email modal (backup copy of your token) */}
            <EmailTokenModal
                visible={emailModal !== null && active === null}
                deviceId={emailModal?.deviceId ?? ''}
                purchaseToken={emailModal?.purchaseToken ?? ''}
                onClose={() => setEmailModal(null)}
                onSkipped={() => {
                    setEmailModal(null);
                    setEmailBannerShown(true);
                }}
                onSubmitted={() => setEmailBannerShown(false)}
            />
        </View>
    );
}

function InfoSection({ icon: Icon, title, desc }: { icon: LucideIcon, title: string, desc: string }) {
    const { themeColors, isDark } = useTheme();
    const styles = getStyles(themeColors);
    return (
        <View style={styles.infoSection}>
            <View style={[styles.infoIcon, { backgroundColor: themeColors.background }]}>
                <Icon size={16} color={readableAccent(themeColors, isDark)} />
            </View>
            <View style={styles.infoContent}>
                <Text style={[styles.infoTitle, { color: themeColors.text }]}>{title}</Text>
                <Text style={[styles.infoDesc, { color: themeColors.mutedText }]}>{desc}</Text>
            </View>
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
    container: { flex: 1 },
    hero: {
        padding: 30,
        paddingTop: 40,
        borderRadius: 24,
        marginBottom: 20,
        shadowColor: themeColors.shadow,
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
    },
    heroContent: { alignItems: 'flex-start' },
    heroBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 20,
        marginBottom: 12,
    },
    heroBadgeText: { ...typography.gateBadge },
    heroTitle: { ...typography.gateTitle, marginBottom: 8, lineHeight: 32 },
    heroSubtitle: { fontSize: 14, lineHeight: 20 },
    content: { paddingHorizontal: 20, gap: 20, paddingBottom: 40 },
    sectionTitle: { ...typography.cardTitle, marginBottom: -4 },
    card: {
        padding: 20,
        borderRadius: 24,
        borderWidth: 1,
        gap: 16,
        shadowColor: themeColors.shadow,
        shadowOpacity: 0.2,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
    },
    highlightedCard: {
        borderColor: themeColors.accent,
        borderWidth: 2,
        shadowColor: themeColors.accent,
        shadowOpacity: 0.35,
        elevation: 6,
    },
    telegramRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 8,
    },
    telegramText: {
        fontSize: 12,
        fontWeight: '600',
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardTitle: { ...typography.cardTitle },
    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    planTitle: { ...typography.planTitle },
    planSubtitle: { fontSize: 12 },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 20,
        borderWidth: 1,
    },
    statusText: { ...typography.statusText },
    features: { gap: 10 },
    featureLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    featureText: { ...typography.body },
    description: { ...typography.body },
    // ── IAP / Subscribe ──
    subscribeBtn: {
        height: 52,
        borderRadius: 16,
    },
    subscribeBtnText: { ...typography.primaryBtn },
    actionGroup: { gap: 10 },
    textBtn: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    textBtnLabel: { fontSize: 12, fontWeight: '500', minHeight: 44, textAlign: 'center' },
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 14,
    },
    loadingText: { fontSize: 13 },
    emptyBar: { height: 20, width: 160, borderRadius: 8 },
    // ── Generic ──
    actionBtn: {
        height: 52,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionBtnText: { ...typography.primaryBtn },
    outlineBtn: {
        height: 52,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1.5,
    },
    outlineBtnText: { ...typography.primaryBtn },
    pendingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
    },
    pendingText: { ...typography.medium },
    activeInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 14,
        borderRadius: 12,
    },
    activeInfoText: { ...typography.medium },
    input: {
        height: 52,
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        fontWeight: '600',
        borderWidth: 1,
    },
    iapNotice: {
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
    },
    iapNoticeText: { fontSize: 12, lineHeight: 18 },
    savingsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        borderWidth: 1,
        alignSelf: 'flex-start',
    },
    savingsText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    footer: {
        padding: 24,
        borderRadius: 24,
        gap: 16,
    },
    infoSection: { flexDirection: 'row', gap: 12 },
    infoIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    infoContent: { flex: 1 },
    infoTitle: { ...typography.alertTitle },
    infoDesc: { ...typography.caption, lineHeight: 16 },
    divider: { height: 1, backgroundColor: themeColors.border },
    // ── Email banner (post-purchase) ──
    emailBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: themeColors.surfaceElevated,
        borderColor: themeColors.accent,
        borderWidth: 1,
        borderRadius: 12,
        marginHorizontal: 20,
        marginTop: 12,
        padding: 12,
        paddingRight: 8,
    },
    emailBannerMain: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    emailBannerText: { ...typography.medium, letterSpacing: 0.1 },
    emailBannerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    });
}
