/**
 * The concrete dialogs rendered by `DialogProvider`.
 *
 * Every one of them goes through `AppDialog`, so they all share the same
 * modal shell, backdrop, close button, Android back behaviour and theme
 * tokens (light / dark and every accent).
 */

import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { CheckCircle2, LogOut, TriangleAlert, WifiOff } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { AppDialog } from '../AppDialog';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import i18n from '../../locales';

type ButtonVariant = 'primary' | 'outline' | 'danger';

function DialogButton({
    label,
    onPress,
    variant = 'primary',
    disabled = false,
    style,
}: {
    label: string;
    onPress: () => void;
    variant?: ButtonVariant;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const palette =
        variant === 'primary'
            ? { background: themeColors.accent, foreground: themeColors.accentText, border: themeColors.accent }
            : variant === 'danger'
                ? { background: themeColors.danger, foreground: '#FFFFFF', border: themeColors.danger }
                : { background: 'transparent', foreground: themeColors.text, border: themeColors.border };

    return (
        <TouchableOpacity
            style={[
                styles.btn,
                { backgroundColor: palette.background, borderColor: palette.border },
                disabled && styles.btnDisabled,
                style,
            ]}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            activeOpacity={0.8}
        >
            <Text style={[styles.btnLabel, { color: palette.foreground }]}>{label}</Text>
        </TouchableOpacity>
    );
}

function DialogIcon({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    return (
        <View style={[styles.iconBubble, { backgroundColor: color + '1F', borderColor: color + '40' }]}>
            <Icon size={26} color={color} />
        </View>
    );
}

// ── Sign out ────────────────────────────────────────────────────────────────

export function SignOutConfirmDialog({
    onConfirm,
    onClose,
}: {
    onConfirm: () => void;
    onClose: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    return (
        <AppDialog
            visible
            onClose={onClose}
            title={i18n.t('settings.signOutTitle')}
            subtitle={i18n.t('settings.signOutBody')}
            testID="dialog-sign-out"
            footer={
                <View style={styles.buttonRow}>
                    <DialogButton
                        label={i18n.t('common.cancel')}
                        variant="outline"
                        onPress={onClose}
                        style={styles.flex}
                    />
                    <DialogButton
                        label={i18n.t('settings.signOutConfirm')}
                        variant="danger"
                        onPress={onConfirm}
                        style={styles.flex}
                    />
                </View>
            }
        >
            <DialogIcon icon={LogOut} color={themeColors.warning} />
        </AppDialog>
    );
}

// ── Purchase restored / completed ───────────────────────────────────────────

export function PurchaseSuccessDialog({
    tier,
    planTitle,
    expiresAt,
    onClose,
}: {
    tier: 'vip' | 'paid';
    planTitle: string;
    expiresAt?: string;
    onClose: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const tierLabel = tier === 'vip' ? i18n.t('matchCard.vip') : i18n.t('matchCard.paid');
    const expiry = expiresAt ? new Date(expiresAt) : null;
    const hasExpiry = expiry !== null && !Number.isNaN(expiry.getTime());
    const body =
        hasExpiry && expiry
            ? i18n.t('market.purchaseActivatedBody', {
                plan: planTitle,
                date: expiry.toLocaleDateString(),
            })
            : i18n.t('market.purchaseActivatedBodyNoExpiry', { plan: planTitle });

    return (
        <AppDialog
            visible
            onClose={onClose}
            title={i18n.t('market.purchaseActivatedTitle', { tier: tierLabel })}
            subtitle={body}
            testID="dialog-purchase-success"
            footer={<DialogButton label={i18n.t('common.ok')} onPress={onClose} style={styles.flex} />}
        >
            <DialogIcon icon={CheckCircle2} color={themeColors.success} />
        </AppDialog>
    );
}

// ── Purchase failed ─────────────────────────────────────────────────────────

export function PurchaseFailedDialog({
    message,
    onRetry,
    onClose,
}: {
    message: string;
    onRetry?: () => void;
    onClose: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const handleRetry = () => {
        onClose();
        onRetry?.();
    };

    return (
        <AppDialog
            visible
            onClose={onClose}
            title={i18n.t('market.purchaseFailedTitle')}
            subtitle={message}
            testID="dialog-purchase-failed"
            footer={
                onRetry ? (
                    <View style={styles.buttonRow}>
                        <DialogButton
                            label={i18n.t('common.cancel')}
                            variant="outline"
                            onPress={onClose}
                            style={styles.flex}
                        />
                        <DialogButton label={i18n.t('common.retry')} onPress={handleRetry} style={styles.flex} />
                    </View>
                ) : (
                    <DialogButton
                        label={i18n.t('common.close')}
                        variant="outline"
                        onPress={onClose}
                        style={styles.flex}
                    />
                )
            }
        >
            <DialogIcon icon={TriangleAlert} color={themeColors.danger} />
        </AppDialog>
    );
}

// ── API unreachable ─────────────────────────────────────────────────────────

export function NoConnectionDialog({
    onRetry,
    onClose,
}: {
    onRetry: () => Promise<boolean>;
    onClose: () => void;
}) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const [retrying, setRetrying] = useState(false);
    const [failed, setFailed] = useState(false);

    const handleRetry = async () => {
        if (retrying) return;
        setRetrying(true);
        setFailed(false);
        try {
            const ok = await onRetry();
            if (ok) onClose();
            else setFailed(true);
        } catch {
            setFailed(true);
        } finally {
            setRetrying(false);
        }
    };

    return (
        <AppDialog
            visible
            onClose={onClose}
            title={i18n.t('common.offlineTitle')}
            subtitle={failed ? i18n.t('common.offlineRetryFailed') : i18n.t('common.offlineBody')}
            testID="dialog-no-connection"
            footer={
                <View style={styles.buttonRow}>
                    <DialogButton
                        label={i18n.t('common.close')}
                        variant="outline"
                        onPress={onClose}
                        disabled={retrying}
                        style={styles.flex}
                    />
                    <TouchableOpacity
                        style={[styles.btn, { backgroundColor: themeColors.accent, borderColor: themeColors.accent }]}
                        onPress={() => void handleRetry()}
                        disabled={retrying}
                        accessibilityRole="button"
                        activeOpacity={0.8}
                    >
                        {retrying ? (
                            <ActivityIndicator size="small" color={themeColors.accentText} />
                        ) : (
                            <Text style={[styles.btnLabel, { color: themeColors.accentText }]}>
                                {i18n.t('common.retry')}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
            }
        >
            <DialogIcon icon={WifiOff} color={themeColors.warning} />
        </AppDialog>
    );
}

// ── Telegram could not be opened ────────────────────────────────────────────

export function TelegramErrorDialog({ onClose }: { onClose: () => void }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    return (
        <AppDialog
            visible
            onClose={onClose}
            title={i18n.t('common.telegramErrorTitle')}
            subtitle={i18n.t('common.telegramErrorBody')}
            testID="dialog-telegram-error"
            footer={<DialogButton label={i18n.t('common.ok')} onPress={onClose} style={styles.flex} />}
        >
            <DialogIcon icon={TriangleAlert} color={themeColors.warning} />
        </AppDialog>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        buttonRow: {
            flexDirection: 'row',
            gap: 10,
        },
        flex: {
            flex: 1,
        },
        btn: {
            minHeight: 48,
            borderRadius: 14,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
        },
        btnDisabled: {
            opacity: 0.55,
        },
        btnLabel: {
            ...typography.primaryBtn,
            fontSize: 13,
        },
        iconBubble: {
            width: 56,
            height: 56,
            borderRadius: 28,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'center',
            backgroundColor: themeColors.glass,
        },
    });
}
