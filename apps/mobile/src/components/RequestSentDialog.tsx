/**
 * RequestSentDialog — shown after the VIP/Premium membership request was
 * accepted. Points the user at email and offers Telegram as an alternative.
 */

import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MessageCircle } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { typography } from '../theme/typography';
import { joinTelegram } from '../lib/telegram';

export function RequestSentDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.backdrop}>
                <View style={styles.card}>
                    <Text style={[styles.title, { color: themeColors.text }]}>Request Sent</Text>
                    <Text style={[styles.body, { color: themeColors.textMuted }]}>
                        Your code will arrive by email once approved.
                    </Text>
                    <View style={styles.actions}>
                        <TouchableOpacity style={[styles.okBtn, { backgroundColor: themeColors.primary }]} onPress={onClose}>
                            <Text style={styles.okText}>OK</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tgBtn, { borderColor: themeColors.border }]} onPress={() => void joinTelegram()}>
                            <MessageCircle size={14} color={themeColors.textMuted} />
                            <Text style={[styles.tgText, { color: themeColors.textMuted }]}>Telegram</Text>
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
            gap: 12,
            alignItems: 'center',
        },
        title: { ...typography.gateTitle, textAlign: 'center' },
        body: { fontSize: 13, textAlign: 'center' },
        actions: { flexDirection: 'row', gap: 10, width: '100%' },
        okBtn: {
            flex: 1,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        okText: { color: '#fff', ...typography.primaryBtn },
        tgBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 13,
            borderRadius: 14,
            borderWidth: 1,
        },
        tgText: { ...typography.secondaryBtn },
    });
}
