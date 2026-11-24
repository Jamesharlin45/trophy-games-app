/**
 * EmailTokenModal — shown right after a successful Google Play purchase
 * (VIP or Paid) and after a restore that creates a token. The buyer enters the
 * address where we should mail the backup copy of the access token. Skipping
 * posts nothing; the parent shows a "reopen" banner afterwards.
 *
 * It uses the shared AppDialog shell like every other dialog in the app.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AppDialog } from './AppDialog';
import { useTheme } from '../context/ThemeContext';
import { typography } from '../theme/typography';
import { api } from '../api/client';
import i18n from '../locales';

interface EmailTokenModalProps {
    visible: boolean;
    deviceId: string;
    purchaseToken: string;
    onClose: () => void;
    onSkipped: () => void;
    /** Called after a successful submit (before onClose). */
    onSubmitted?: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailTokenModal({
    visible,
    deviceId,
    purchaseToken,
    onClose,
    onSkipped,
    onSubmitted,
}: EmailTokenModalProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const [email, setEmail] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!visible) return;
        setEmail('');
        setSending(false);
        setSent(false);
        setError(null);
    }, [visible]);

    const emailValid = EMAIL_PATTERN.test(email.trim());

    const handleSend = async () => {
        if (!emailValid || !purchaseToken || sending) return;
        setSending(true);
        setError(null);
        try {
            const result = await api.purchases.setEmail({
                deviceId,
                purchaseToken,
                email: email.trim(),
            });
            if (result.success) {
                setSent(true);
            } else {
                setError(result.reason || i18n.t('market.emailModalError'));
            }
        } catch {
            setError(i18n.t('market.emailModalError'));
        } finally {
            setSending(false);
        }
    };

    const finish = () => {
        onSubmitted?.();
        onClose();
    };

    if (sent) {
        return (
            <AppDialog
                visible={visible}
                onClose={finish}
                title={i18n.t('market.emailModalTitle')}
                subtitle={i18n.t('market.emailModalTimeout')}
                dismissOnBackdrop={false}
                showClose={false}
                testID="email-token-sent"
            />
        );
    }

    return (
        <AppDialog
            visible={visible}
            // Android back / any dismissal of the input step counts as a skip,
            // so the parent can show the "add your email" banner again.
            onClose={onSkipped}
            title={i18n.t('market.emailModalTitle')}
            subtitle={i18n.t('market.emailModalBody')}
            dismissOnBackdrop={false}
            showClose={false}
            testID="email-token-modal"
            footer={
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[
                            styles.sendBtn,
                            { backgroundColor: themeColors.accent, opacity: !emailValid || sending ? 0.5 : 1 },
                        ]}
                        onPress={() => void handleSend()}
                        disabled={!emailValid || sending}
                        accessibilityRole="button"
                    >
                        {sending ? (
                            <ActivityIndicator color={themeColors.accentText} size="small" />
                        ) : (
                            <Text style={[styles.sendBtnText, { color: themeColors.accentText }]}>
                                {i18n.t('market.emailModalSend')}
                            </Text>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onSkipped} accessibilityRole="button" disabled={sending}>
                        <Text style={[styles.skipText, { color: themeColors.mutedText }]}>
                            {i18n.t('market.emailModalSkip')}
                        </Text>
                    </TouchableOpacity>
                </View>
            }
        >
            <TextInput
                style={[
                    styles.input,
                    {
                        color: themeColors.text,
                        borderColor: themeColors.border,
                        backgroundColor: themeColors.surfaceElevated,
                    },
                ]}
                placeholder={i18n.t('market.emailModalPlaceholder')}
                placeholderTextColor={themeColors.mutedText}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!sending}
            />
            {error ? (
                <Text style={[styles.errorText, { color: themeColors.danger }]}>{error}</Text>
            ) : null}
            {sending ? <ActivityIndicator color={themeColors.accent} size="small" /> : null}
        </AppDialog>
    );
}

function getStyles() {
    return StyleSheet.create({
        input: {
            height: 52,
            borderRadius: 12,
            paddingHorizontal: 16,
            fontSize: 16,
            fontWeight: '600',
            borderWidth: 1,
        },
        errorText: { ...typography.medium, fontSize: 12, textAlign: 'center' },
        actions: { gap: 6, alignItems: 'center' },
        sendBtn: {
            height: 50,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'stretch',
        },
        sendBtnText: { ...typography.primaryBtn },
        skipText: { ...typography.medium, fontSize: 13, paddingVertical: 8 },
    });
}

export default EmailTokenModal;
