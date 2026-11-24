import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { Stack, useRouter } from 'expo-router';
import { Bell, ArrowLeft } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useScreenQuery } from '../hooks/useLiveQuery';
import { getDeviceId } from '../utils/deviceId';
import { safeString, safeDateTime } from '../utils/safeData';
import i18n from '../locales';

export default function AlertsScreen() {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const router = useRouter();
    const [deviceId, setDeviceId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getDeviceId()
            .then((id) => { if (!cancelled) setDeviceId(id); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const { data: alerts, refetch } = useScreenQuery(
        () => api.alerts.getAlerts(deviceId || 'unknown'),
        [deviceId],
        { pollMs: 60000 },
    );

    const handleMarkRead = async (id: string) => {
        if (deviceId) {
            await api.alerts.markRead(id, deviceId);
            await refetch();
        }
    };

    const handleMarkAllRead = async () => {
        if (deviceId) {
            await api.alerts.markAllRead(deviceId);
            await refetch();
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: themeColors.background }]} edges={['bottom']}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={[styles.header, { borderBottomColor: themeColors.border }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <ArrowLeft size={24} color={themeColors.text} />
                </TouchableOpacity>
                <View style={styles.headerIcon}>
                    <Bell size={20} color={themeColors.text} />
                </View>
                <Text style={[styles.headerTitle, { color: themeColors.text }]}>{i18n.t('alerts.title')}</Text>
                {alerts && alerts.some(a => !(a.readBy ?? []).includes(deviceId || "unknown")) && (
                    <TouchableOpacity onPress={handleMarkAllRead} style={styles.markReadText} accessibilityRole="button">
                        <Text style={{ color: themeColors.accent, fontSize: 12, fontWeight: '700' }}>{i18n.t('alerts.markAllRead')}</Text>
                    </TouchableOpacity>
                )}
            </View>

            <View style={styles.content}>
                {alerts && alerts.length > 0 ? (
                    <FlatList
                        data={alerts}
                        keyExtractor={item => safeString(item._id) || safeString(item.createdAt) || 'alert'}
                        renderItem={({ item }) => {
                            const alertId = safeString(item._id);
                            const isRead = (item.readBy ?? []).includes(deviceId || "unknown");
                            return (
                                <TouchableOpacity
                                    onPress={() => alertId && handleMarkRead(alertId)}
                                    activeOpacity={0.7}
                                    style={[
                                        styles.alertCard,
                                        {
                                            backgroundColor: themeColors.surface,
                                            borderColor: isRead ? themeColors.border : themeColors.accent + '40',
                                            borderLeftColor: isRead ? themeColors.border : themeColors.accent,
                                            borderLeftWidth: 4
                                        }
                                    ]}
                                >
                                    <View style={styles.alertHeader}>
                                        <Text style={[styles.alertTitle, { color: themeColors.text }]}>{safeString(item.title)}</Text>
                                        {!isRead && <View style={[styles.unreadDot, { backgroundColor: themeColors.accent }]} />}
                                    </View>
                                    <Text style={[styles.alertBody, { color: themeColors.mutedText }]}>{safeString(item.body)}</Text>
                                    <Text style={[styles.alertTime, { color: themeColors.mutedText }]}>
                                        {safeDateTime(item.createdAt, '')}
                                    </Text>
                                </TouchableOpacity>
                            );
                        }}
                        contentContainerStyle={styles.listContainer}
                    />
                ) : (
                    <View style={styles.emptyState}>
                        <Bell size={48} color={themeColors.mutedText} style={styles.emptyIcon} />
                        <Text style={[styles.emptyTitle, { color: themeColors.text }]}>{i18n.t('alerts.emptyTitle')}</Text>
                        <Text style={[styles.emptySubtitle, { color: themeColors.mutedText }]}>
                            {i18n.t('alerts.emptySub')}
                        </Text>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
        gap: 12,
    },
    backBtn: {
        padding: 4,
    },
    headerIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: themeColors.glass,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: -0.5,
    },
    content: {
        flex: 1,
    },
    listContainer: {
        padding: 16,
        gap: 12,
    },
    alertCard: {
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    alertTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    alertBody: {
        fontSize: 14,
    },
    emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    emptyIcon: {
        marginBottom: 16,
        opacity: 0.5,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 15,
        textAlign: 'center',
    },
    alertHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    alertTime: {
        fontSize: 10,
        marginTop: 8,
        textAlign: 'right',
    },
    markReadText: {
        marginLeft: 'auto',
    }
    });
}
