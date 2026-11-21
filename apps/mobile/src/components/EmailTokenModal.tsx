/**
 * EmailTokenModal — shown right after a successful Google Play purchase
 * (VIP or Paid): the buyer enters the email address where we should mail
 * them their access token, as a backup copy for other devices and
 * reinstalls. Skipping it posts to the server only if an address was
 * entered; the parent shows a "reopen" banner afterwards.
 *
 * After sending: "Your token will arrive by email in about 10 minutes."
 */

import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Mail } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { typography } from '../theme/typography';
import { api } from '../api/client';

interface EmailTokenModalProps {
    visible: boolean;
    deviceId: string;
    purchaseToken: string;
    onClose: () => void;
    onSkipped: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailTokenModal({
    visible,
    deviceId,
    purchaseToken,
    onClose,
    onSkipped,
}: EmailTokenModalProps) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    const [email, setEmail] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset the form whenever the modal opens again (parent keeps it mounted).
    useEffect(() => {
        if (visible) {
            setEmail('');
            setSending(false);
            setSent(false);
            setError(null);
        }
    }, [visible]);

    if (!visible) return null;

    const emailValid = EMAIL_PATTERN.test(email.trim());

    const handleSend = async () => {
        if (!emailValid || !purchaseToken) return;
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
                setError(result.reason || 'Could not save your email. Try again.');
            }
        } catch {
            setError('Could not save your email. Try again.');
        } finally {
            setSending(false);
        }
    };

    if (sent) {
        return (
            <View style={styles.overlay}>
                <View style={styles.dialog}>
                    <Mail size={20} color={themeColors.accent} />
                    <Text style={[styles.title, { color: themeColors.text }]}>Your token by email</Text>
                    <Text style={[styles.subtitle, { color: themeColors.mutedText }]}>
                        Your token will arrive by email in about 10 minutes.
                    </Text>
                    <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
                        <Text style={styles.doneBtnText}>Done</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.overlay}>
            <View style={styles.dialog}>
                <Mail size={20} color={themeColors.accent} />
                <Text style={[styles.title, { color: themeColors.text }]}>Your token by email</Text>
                <Text style={[styles.subtitle, { color: themeColors.mutedText }]}>
                    Enter the email address where we should mail you your access token. We'll send it about 10 minutes after your purchase — it works on every device and after reinstalls.
                </Text>
                <TextInput
                    style={[styles.input, { color: themeColors.text }]}
                    placeholder="you@example.com"
                    placeholderTextColor={themeColors.mutedText}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                />
                {error ? (
                    <Text style={[styles.errorText, { color: themeColors.danger }]}>{error}</Text>
                ) : null}
                <TouchableOpacity
                    style={[styles.sendBtn, { backgroundColor: themeColors.accent }]}
                    onPress={handleSend}
                    disabled={!emailValid || sending}
                >
                    {sending ? (
                        <ActivityIndicator color="white" size="small" />
                    ) : (
                        <Text style={styles.sendBtnText}>Send my token</Text>
                    )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.skipBtn} onPress={onSkipped}>
                    <Text style={[styles.skipBtnText, { color: themeColors.mutedText }]}>Skip for now</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        overlay: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
        },
        dialog: {
            backgroundColor: themeColors.surface,
            borderRadius: 20,
            padding: 24,
            width: '85%',
            maxWidth: 420,
            gap: 12,
            alignItems: 'center',
            shadowColor: themeColors.shadow,
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
        },
        title: {
            ...typography.cardTitle,
            fontSize: 17,
            letterSpacing: 0.2,
        },
        subtitle: {
            ...typography.body,
            textAlign: 'center',
        },
        input: {
            height: 52,
            borderRadius: 12,
            paddingHorizontal: 16,
            fontSize: 16,
            fontWeight: '600',
            borderWidth: 1,
            borderColor: themeColors.border,
        },
        errorText: { ...typography.medium, fontSize: 12, textAlign: 'center' },
        sendBtn: {
            height: 52,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
        },
        sendBtnText: { ...typography.primaryBtn },
        skipBtn: {
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
        },
        skipBtnText: { ...typography.medium },
        doneBtn: {
            height: 52,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: themeColors.accent,
        },
        doneBtnText: { ...typography.primaryBtn, color: 'white' },
    });
}
