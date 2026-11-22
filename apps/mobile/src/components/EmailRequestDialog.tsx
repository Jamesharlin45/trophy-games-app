/**
 * EmailRequestDialog — AppDialog-based email capture for both manual token
 * requests and restored purchases. The address is validated locally before the
 * caller submits it to the server.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Mail } from 'lucide-react-native';
import { AppDialog } from './AppDialog';
import { useTheme } from '../context/ThemeContext';
import { typography } from '../theme/typography';
import i18n from '../locales';

export interface EmailSubmitResult {
    ok: boolean;
    error?: string;
}

export interface EmailRequestDialogProps {
    visible: boolean;
    title: string;
    subtitle?: string;
    /** Shown below the input, e.g. "We will email your token when it is approved". */
    note: string;
    submitLabel?: string;
    onSubmit: (email: string) => Promise<EmailSubmitResult>;
    /** Called after a successful submit, before the dialog closes. */
    onSubmitted?: () => void;
    onClose: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailRequestDialog({
    visible,
    title,
    subtitle,
    note,
    submitLabel,
    onSubmit,
    onSubmitted,
    onClose,
}: EmailRequestDialogProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setEmail('');
        setError(null);
        setBusy(false);
    }, [visible]);

    const handleSubmit = async () => {
        const address = email.trim();
        if (!EMAIL_PATTERN.test(address)) {
            setError(i18n.t('emailRequest.invalid'));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const result = await onSubmit(address);
            if (!result.ok) {
                setError(result.error || i18n.t('emailRequest.failed'));
                return;
            }
            onSubmitted?.();
            onClose();
        } catch {
            setError(i18n.t('emailRequest.failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <AppDialog
            visible={visible}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            dismissOnBackdrop={!busy}
            showClose={!busy}
            testID="email-request-dialog"
            footer={
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: themeColors.accent }]}
                        onPress={() => void handleSubmit()}
                        disabled={busy}
                        accessibilityRole="button"
                    >
                        {busy ? (
                            <ActivityIndicator color={themeColors.accentText} size="small" />
                        ) : (
                            <Text style={[styles.buttonText, { color: themeColors.accentText }]}>
                                {submitLabel ?? i18n.t('emailRequest.submit')}
                            </Text>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.button, styles.secondaryButton, { borderColor: themeColors.border }]}
                        onPress={onClose}
                        disabled={busy}
                        accessibilityRole="button"
                    >
                        <Text style={[styles.buttonText, { color: themeColors.text }]}>
                            {i18n.t('common.cancel')}
                        </Text>
                    </TouchableOpacity>
                </View>
            }
        >
            <View style={styles.inputWrap}>
                <Mail size={18} color={themeColors.accent} />
                <TextInput
                    style={[styles.input, { color: themeColors.text, borderColor: themeColors.border, backgroundColor: themeColors.surfaceElevated }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={i18n.t('emailRequest.placeholder')}
                    placeholderTextColor={themeColors.mutedText}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                    accessibilityLabel={i18n.t('emailRequest.placeholder')}
                />
            </View>
            <Text style={[styles.note, { color: themeColors.mutedText }]}>{note}</Text>
            {error ? <Text style={[styles.error, { color: themeColors.danger }]}>{error}</Text> : null}
        </AppDialog>
    );
}

function getStyles() {
    return StyleSheet.create({
        inputWrap: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
        },
        input: {
            flex: 1,
            height: 48,
            borderRadius: 12,
            borderWidth: 1,
            paddingHorizontal: 12,
            fontSize: 15,
        },
        note: {
            ...typography.medium,
            fontSize: 12,
            textAlign: 'center',
        },
        error: {
            ...typography.medium,
            fontSize: 12,
            textAlign: 'center',
        },
        actions: {
            gap: 8,
        },
        button: {
            height: 48,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
        },
        secondaryButton: {
            borderWidth: 1,
            backgroundColor: 'transparent',
        },
        buttonText: {
            ...typography.primaryBtn,
        },
    });
}

export default EmailRequestDialog;
