/**
 * PlanCard — a membership plan summary shared by the locked Premium/VIP tabs.
 *
 * Adapted from the parallel redesign branch to the current neon design system:
 * all colours come from `themeColors`, spacing/typography from the local
 * tokens, and purchases use the existing `useIap` flow.
 */

import { StyleSheet, Text, View } from 'react-native';
import {
    CheckCircle2,
    Clock,
    Crown,
    ShoppingCart,
    Sparkles,
    Trophy,
    Zap,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import type { ProductSubscription } from '../../hooks/useIap';
import { AppButton } from '../design/AppButton';
import { readableAccent } from './tokens';
import i18n from '../../locales';

export type MembershipTier = 'vip' | 'paid';
export type MemberStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'active' | 'loading';

export interface PlanCardProps {
    tier: MembershipTier;
    title: string;
    subtitle: string;
    features: readonly string[];
    product?: ProductSubscription;
    status: MemberStatus;
    isActiveProduct: boolean;
    priceSuffix: string;
    isLoading: boolean;
    purchasing: boolean;
    requesting: boolean;
    onSubscribe: () => void;
    onRequest: () => void;
    savingsLabel?: string;
    billingError?: string | null;
}

function priceOf(product?: ProductSubscription): string | null {
    if (!product) return null;
    return product.displayPrice || product.price || null;
}

export function PlanCard({
    tier,
    title,
    subtitle,
    features,
    product,
    status,
    isActiveProduct,
    priceSuffix,
    isLoading,
    purchasing,
    requesting,
    onSubscribe,
    onRequest,
    savingsLabel,
    billingError,
}: PlanCardProps) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const accent = readableAccent(themeColors);
    const Icon: LucideIcon = tier === 'vip' ? Crown : Trophy;
    const price = priceOf(product);
    const subscribed = status !== 'none' && status !== 'rejected' && status !== 'loading' && isActiveProduct;

    const statusBadge = () => {
        if (isLoading) return null;
        if (subscribed) {
            return (
                <View style={[styles.badge, { backgroundColor: themeColors.glass, borderColor: themeColors.accent }]}>
                    <ShoppingCart size={10} color={accent} />
                    <Text style={[styles.badgeText, { color: accent }]}>{i18n.t('market.statusSubscribed')}</Text>
                </View>
            );
        }
        if (status === 'pending' || status === 'approved' || status === 'active') {
            const color = status === 'pending' ? themeColors.warning : themeColors.success;
            const label = status === 'pending'
                ? i18n.t('market.statusPending')
                : status === 'approved'
                    ? i18n.t('market.statusApproved')
                    : i18n.t('market.statusActive');
            const StatusIcon = status === 'pending' ? Clock : CheckCircle2;
            return (
                <View style={[styles.badge, { backgroundColor: themeColors.glass, borderColor: color }]}>
                    <StatusIcon size={10} color={color} />
                    <Text style={[styles.badgeText, { color }]}>{label}</Text>
                </View>
            );
        }
        return null;
    };

    const actions = () => {
        if (isLoading) {
            return (
                <AppButton loading disabled onPress={() => undefined}>
                    {i18n.t('common.checking')}
                </AppButton>
            );
        }

        if (status === 'none' || status === 'rejected') {
            return (
                <View style={styles.actions}>
                    {billingError ? (
                        <Text style={[styles.billingNotice, { color: themeColors.mutedText }]}>
                            {i18n.t('market.iapNotice', { error: i18n.t('market.iapNoticeUnavailable') })}
                        </Text>
                    ) : (
                        <AppButton
                            Icon={ShoppingCart}
                            onPress={onSubscribe}
                            loading={purchasing}
                            disabled={purchasing || requesting}
                        >
                            {price
                                ? `${price}${priceSuffix}`
                                : i18n.t('market.subscribeBtn')}
                        </AppButton>
                    )}
                    <AppButton
                        variant="ghost"
                        onPress={onRequest}
                        loading={requesting}
                        disabled={requesting || purchasing}
                    >
                        {i18n.t('market.requestTokenBtn')}
                    </AppButton>
                </View>
            );
        }

        if (status === 'pending') {
            return (
                <View style={[styles.stateRow, { backgroundColor: themeColors.glass, borderColor: themeColors.border }]}>
                    <Clock size={16} color={themeColors.warning} />
                    <Text style={[styles.stateText, { color: themeColors.mutedText }]}>
                        {i18n.t('market.reviewingBody')}
                    </Text>
                </View>
            );
        }

        return (
            <View style={[styles.stateRow, { backgroundColor: themeColors.glass, borderColor: themeColors.accent }]}>
                <CheckCircle2 size={16} color={accent} />
                <Text style={[styles.stateText, { color: accent }]}>
                    {i18n.t('market.accessActive')}
                </Text>
            </View>
        );
    };

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: themeColors.surface,
                    borderColor: isActiveProduct ? themeColors.accent : themeColors.border,
                    borderWidth: isActiveProduct ? 2 : 1,
                },
            ]}
        >
            <View style={styles.top}>
                <View style={styles.header}>
                    <View style={[styles.iconWrap, { backgroundColor: themeColors.glass, borderColor: themeColors.border }]}>
                        <Icon size={22} color={accent} strokeWidth={2.2} />
                    </View>
                    <View style={styles.copy}>
                        <Text style={[styles.title, { color: themeColors.text }]}>{title}</Text>
                        <Text style={[styles.subtitle, { color: themeColors.mutedText }]}>{subtitle}</Text>
                    </View>
                </View>
                {statusBadge()}
            </View>

            <View style={styles.features}>
                {features.map((feature) => (
                    <View key={feature} style={styles.feature}>
                        <CheckCircle2 size={14} color={accent} strokeWidth={2.4} />
                        <Text style={[styles.featureText, { color: themeColors.textSecondary }]}>{feature}</Text>
                    </View>
                ))}
            </View>

            {savingsLabel ? (
                <View style={[styles.savings, { backgroundColor: themeColors.glass, borderColor: themeColors.border }]}>
                    <Zap size={11} color={accent} />
                    <Text style={[styles.savingsText, { color: accent }]}>{savingsLabel}</Text>
                </View>
            ) : null}

            {actions()}

            {tier === 'vip' && !savingsLabel ? (
                <View style={styles.footer}>
                    <Sparkles size={11} color={themeColors.mutedText} />
                    <Text style={[styles.footerText, { color: themeColors.mutedText }]}>
                        {i18n.t('market.infoTitle1')}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        card: {
            width: '100%',
            borderRadius: 20,
            padding: 18,
            gap: 14,
            shadowColor: themeColors.shadow,
            shadowOpacity: 0.2,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
        },
        top: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
        },
        header: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
        iconWrap: {
            width: 44,
            height: 44,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
        },
        copy: { flex: 1, minWidth: 0 },
        title: { ...typography.planTitle },
        subtitle: { ...typography.body, marginTop: 2 },
        badge: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            borderWidth: 1,
        },
        badgeText: { ...typography.statusText },
        features: { gap: 8 },
        feature: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        featureText: { ...typography.body, flex: 1 },
        savings: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 10,
            borderWidth: 1,
        },
        savingsText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
        actions: { gap: 8 },
        billingNotice: { ...typography.body, textAlign: 'center' },
        stateRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            minHeight: 48,
            borderRadius: 14,
            borderWidth: 1,
        },
        stateText: { ...typography.medium, textAlign: 'center' },
        footer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        footerText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
    });
}

export default PlanCard;
