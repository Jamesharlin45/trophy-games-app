/**
 * SubscriptionDialog — the one-time offer shown (a) right after a username is
 * chosen for the first time and (b) once per app launch for members without an
 * active VIP or Paid membership.
 *
 * It lists exactly the same three plans as the Store tab, using the live
 * Google Play prices (a plan whose price has not loaded shows its name only —
 * never a hard-coded amount), and its pulsing Subscribe button closes the
 * dialog and opens the Store tab scrolled to the selected plan.
 */

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Crown, Sparkles, Trophy } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { SUBSCRIPTION_PRODUCTS } from '@trophy-games/shared/subscriptions';
import { AppDialog } from '../AppDialog';
import { AnimatedPulse } from '../AnimatedPulse';
import { useTheme } from '../../context/ThemeContext';
import { usePlanPrices } from '../../hooks/usePlanPrices';
import { typography } from '../../theme/typography';
import i18n, { tArray } from '../../locales';

interface PlanDefinition {
    productId: string;
    titleKey: string;
    subtitleKey: string;
    featuresKey: string;
    Icon: LucideIcon;
}

/** Same order and products as the Store tab. */
const PLANS: PlanDefinition[] = [
    {
        productId: SUBSCRIPTION_PRODUCTS.VIP_WEEKLY.productId,
        titleKey: 'market.vipWeeklyTitle',
        subtitleKey: 'market.vipWeeklySubtitle',
        featuresKey: 'market.vipWeeklyFeatures',
        Icon: Crown,
    },
    {
        productId: SUBSCRIPTION_PRODUCTS.VIP_MONTHLY.productId,
        titleKey: 'market.vipMonthlyTitle',
        subtitleKey: 'market.vipMonthlySubtitle',
        featuresKey: 'market.vipMonthlyFeatures',
        Icon: Crown,
    },
    {
        productId: SUBSCRIPTION_PRODUCTS.PAID_MONTHLY.productId,
        titleKey: 'market.paidMonthlyTitle',
        subtitleKey: 'market.paidMonthlySubtitle',
        featuresKey: 'market.paidMonthlyFeatures',
        Icon: Trophy,
    },
];

const BENEFITS_PER_PLAN = 2;

export function SubscriptionDialog({
    greeting,
    onClose,
}: {
    /** Username to greet with, when the dialog follows onboarding. */
    greeting?: string;
    onClose: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const router = useRouter();
    const { prices, refresh } = usePlanPrices();
    const [selectedProductId, setSelectedProductId] = useState(PLANS[0].productId);

    // Prices may still be loading when the dialog opens — ask once more.
    useEffect(() => {
        if (Object.keys(prices).length === 0) refresh();
    }, [prices, refresh]);

    const handleSubscribe = () => {
        const plan = selectedProductId;
        onClose();
        router.push({ pathname: '/(tabs)/market', params: { plan } });
    };

    return (
        <AppDialog
            visible
            onClose={onClose}
            testID="dialog-subscription"
            footer={
                <View style={styles.footer}>
                    <AnimatedPulse
                        style={[styles.subscribeBtn, { backgroundColor: themeColors.accent }]}
                        onPress={handleSubscribe}
                        accessibilityLabel={i18n.t('subscription.subscribe')}
                    >
                        <Sparkles size={16} color={themeColors.accentText} />
                        <Text style={[styles.subscribeLabel, { color: themeColors.accentText }]}>
                            {i18n.t('subscription.subscribe')}
                        </Text>
                    </AnimatedPulse>
                    <TouchableOpacity
                        style={styles.laterBtn}
                        onPress={onClose}
                        accessibilityRole="button"
                        hitSlop={8}
                    >
                        <Text style={[styles.laterText, { color: themeColors.mutedText }]}>
                            {i18n.t('subscription.maybeLater')}
                        </Text>
                    </TouchableOpacity>
                </View>
            }
        >
            <View style={styles.head}>
                <View style={[styles.iconBubble, { backgroundColor: themeColors.accent + '1F', borderColor: themeColors.accent + '40' }]}>
                    <Sparkles size={26} color={themeColors.accent} />
                </View>
                <Text style={[styles.title, { color: themeColors.text }]}>
                    {greeting ? i18n.t('subscription.greeting', { username: greeting }) : i18n.t('subscription.title')}
                </Text>
                <Text style={[styles.subtitle, { color: themeColors.mutedText }]}>{i18n.t('subscription.subtitle')}</Text>
            </View>

            <ScrollView
                style={styles.plans}
                contentContainerStyle={styles.plansContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
            >
                {PLANS.map((plan) => {
                    const selected = plan.productId === selectedProductId;
                    const price = prices[plan.productId];
                    const benefits = tArray<string>(plan.featuresKey).slice(0, BENEFITS_PER_PLAN);

                    return (
                        <TouchableOpacity
                            key={plan.productId}
                            style={[
                                styles.planRow,
                                {
                                    borderColor: selected ? themeColors.accent : themeColors.border,
                                    backgroundColor: selected ? themeColors.accent + '14' : themeColors.surfaceElevated,
                                },
                            ]}
                            onPress={() => setSelectedProductId(plan.productId)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            activeOpacity={0.8}
                        >
                            <View style={[styles.planIcon, { backgroundColor: themeColors.accent + '1F' }]}>
                                <plan.Icon size={18} color={themeColors.accent} />
                            </View>

                            <View style={styles.planInfo}>
                                <Text style={[styles.planTitle, { color: themeColors.text }]}>{i18n.t(plan.titleKey)}</Text>
                                <Text style={[styles.planSubtitle, { color: themeColors.mutedText }]}>
                                    {i18n.t(plan.subtitleKey)}
                                </Text>
                                <View style={styles.benefits}>
                                    {benefits.map((benefit, index) => (
                                        <View key={`${plan.productId}-${index}`} style={styles.benefitRow}>
                                            <Check size={12} color={themeColors.accent} />
                                            <Text style={[styles.benefitText, { color: themeColors.text }]} numberOfLines={1}>
                                                {benefit}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            </View>

                            <View style={styles.planRight}>
                                {price ? <Text style={[styles.price, { color: themeColors.accent }]}>{price}</Text> : null}
                                <View
                                    style={[
                                        styles.radio,
                                        { borderColor: selected ? themeColors.accent : themeColors.border },
                                    ]}
                                >
                                    {selected ? (
                                        <View style={[styles.radioDot, { backgroundColor: themeColors.accent }]} />
                                    ) : null}
                                </View>
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </AppDialog>
    );
}

function getStyles() {
    return StyleSheet.create({
        head: {
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
            paddingHorizontal: 8,
        },
        iconBubble: {
            width: 56,
            height: 56,
            borderRadius: 28,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
        },
        title: {
            ...typography.planTitle,
            fontSize: 19,
            textAlign: 'center',
        },
        subtitle: {
            ...typography.body,
            textAlign: 'center',
        },
        plans: {
            flexShrink: 1,
            maxHeight: 330,
            marginTop: 4,
        },
        plansContent: {
            gap: 10,
            paddingBottom: 4,
        },
        planRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderWidth: 1,
            borderRadius: 16,
            paddingVertical: 12,
            paddingHorizontal: 12,
        },
        planIcon: {
            width: 36,
            height: 36,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        planInfo: {
            flex: 1,
            gap: 2,
        },
        planTitle: {
            ...typography.alertTitle,
            fontSize: 14,
            letterSpacing: 0.4,
        },
        planSubtitle: {
            fontSize: 11,
            fontWeight: '500',
        },
        benefits: {
            marginTop: 6,
            gap: 4,
        },
        benefitRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        benefitText: {
            ...typography.body,
            fontSize: 12,
            flexShrink: 1,
        },
        planRight: {
            alignItems: 'flex-end',
            gap: 8,
            minWidth: 74,
        },
        price: {
            fontSize: 12,
            fontWeight: '700',
            textAlign: 'right',
        },
        radio: {
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            alignItems: 'center',
            justifyContent: 'center',
        },
        radioDot: {
            width: 10,
            height: 10,
            borderRadius: 5,
        },
        footer: {
            gap: 6,
            marginTop: 4,
        },
        subscribeBtn: {
            minHeight: 52,
            borderRadius: 16,
            flexDirection: 'row',
            gap: 8,
        },
        subscribeLabel: {
            ...typography.primaryBtn,
            fontSize: 14,
            letterSpacing: 1,
        },
        laterBtn: {
            minHeight: 40,
            alignItems: 'center',
            justifyContent: 'center',
        },
        laterText: {
            ...typography.medium,
            fontSize: 13,
            textDecorationLine: 'underline',
        },
    });
}

export default SubscriptionDialog;
