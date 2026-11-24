/**
 * EmailRequestDialog — email capture for the VIP/Premium membership request
 * flow. The address is validated before submitting; on success the caller
 * stores it so it prefills next time.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Mail } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { typography } from '../theme/typography';
import { safeString } from '../utils/safeData';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailSubmitResult {
    ok: boolean;
    error?: string;
}

export interface EmailRequestDialogProps {
    visible: boolean;
    title: string;
    subtitle?: string;
    /** Shown below the input, e.g. "Your code will be emailed when approved". */
    note: string;
    submitLabel?: string;
    /** Prefilled address, e.g. from AsyncStorage. */
    prefillEmail?: string;
    onSubmit: (email: string) => Promise<EmailSubmitResult>;
    onSubmitted?: () => void;
    onClose: () => void;
}

export function EmailRequestDialog({
    visible,
    title,
    subtitle,
    note,
    submitLabel,
    prefillEmail,
    onSubmit,
    onSubmitted,
    onClose,
}: EmailRequestDialogProps) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const [email, setEmail] = useState(safeString(prefillEmail));
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setEmail(safeString(prefillEmail));
        setError('');
        setBusy(false);
    }, [visible, prefillEmail]);

    const handleSubmit = async () => {
        const address = email.trim();
        if (!EMAIL_PATTERN.test(address)) {
            setError('Please enter a valid email address.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await onSubmit(address);
            if (!result.ok) {
                setError(result.error || 'Failed to send the request. Please try again.');
                return;
            }
            onSubmitted?.();
            onClose();
        } catch {
            setError('Failed to send the request. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <View style={styles.header}>
                        <Mail size={20} color={themeColors.primary} />
                        <Text style={[styles.title, { color: themeColors.text }]}>{title}</Text>
                    </View>
                    {subtitle && (
                        <Text style={[styles.subtitle, { color: themeColors.textMuted }]}>{subtitle}</Text>
                    )}
                    <View style={styles.inputWrap}>
                        <TextInput
                            style={[styles.input, { color: themeColors.text }]}
                            placeholder="you@example.com"
                            placeholderTextColor={themeColors.textMuted}
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                        />
                        {error ? <Text style={[styles.errorText, { color: themeColors.error }]}>{error}</Text> : null}
                    </View>
                    <Text style={[styles.note, { color: themeColors.textMuted }]}>{note}</Text>
                    <View style={styles.actions}>
                        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: themeColors.primary }]} onPress={() => void handleSubmit()} disabled={busy}>
                            {busy ? (
                                <ActivityIndicator color="#fff" size="small" />
                            ) : (
                                <Text style={styles.submitText}>{submitLabel ?? 'Send Request'}</Text>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.cancelBtn, { borderColor: themeColors.border }]} onPress={onClose} disabled={busy}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        backdrop: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
        },
        card: {
            backgroundColor: themeColors.cardBg,
            borderRadius: 16,
            padding: 20,
            width: '100%',
            maxWidth: 380,
            gap: 8,
        },
        header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        title: { ...typography.gateTitle, fontSize: 16 },
        subtitle: { fontSize: 13, textAlign: 'center' },
        inputWrap: {
            borderWidth: 1,
            borderRadius: 12,
            borderColor: themeColors.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
        },
        input: { ...typography.tokenInput },
        errorText: { ...typography.pendingText },
        note: { fontSize: 11, textAlign: 'center', marginTop: 4 },
        actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
        submitBtn: {
            flex: 1,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        submitText: { color: '#fff', ...typography.primaryBtn },
        cancelBtn: {
            flex: 1,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
        },
        cancelText: { ...typography.primaryBtn },
    });
}
