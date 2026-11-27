import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { useUser } from '../context/UserContext';
import { useDialog } from '../context/DialogContext';
import { Ionicons } from '@expo/vector-icons';
import { accents, type AccentType } from '../theme/colors';
import i18n, { tArray } from '../locales';
import { AppButton } from '../components/design/AppButton';
import { clearLastError, copyLastError, readLastError, formatLastErrorDetails, type LastError } from '../lib/errorDiagnostics';
import {
    copyConnectionDiagnostics,
    deviceCode,
    formatConnectionDiagnostics,
    getConnectionDiagnostics,
    type ConnectionDiagnostics,
} from '../lib/connectionDiagnostics';
import * as Application from 'expo-application';
import { getDeviceId } from '../utils/deviceId';
import { useFocusEffect } from 'expo-router';

const MODE_OPTIONS = [
    { mode: 'light', Icon: 'sunny-outline', labelKey: 'settings.light' as const },
    { mode: 'dark', Icon: 'moon-outline', labelKey: 'settings.dark' as const },
    { mode: 'system', Icon: 'settings-outline', labelKey: 'settings.system' as const },
] as const;

export default function SettingsScreen() {
    const { themeColors, theme, accent, setTheme, setAccent } = useTheme();
    const { locale, setLocale } = useLanguage();
    const { logout } = useUser();
    const { showSignOutConfirm, joinTelegram } = useDialog();
    const styles = getStyles();

    // Diagnostics → "Last error": read the stored crash record on mount.
    const [lastError, setLastError] = useState<LastError | null>(null);
    useEffect(() => {
        void readLastError().then((err) => setLastError(err));
    }, []);

    const handleClearError = () => {
        void clearLastError().then(() => setLastError(null));
    };
    const handleCopyError = () => {
        void copyLastError(lastError);
    };

    // Diagnostics → "Connection and data": host only, no query strings/keys.
    const [connection, setConnection] = useState<ConnectionDiagnostics>(getConnectionDiagnostics());
    const [supportCode, setSupportCode] = useState('TG-0000-0000');
    useFocusEffect(useCallback(() => {
        setConnection(getConnectionDiagnostics());
        void getDeviceId().then((id) => setSupportCode(deviceCode(id))).catch(() => {});
    }, []));

    const nativeBuildNumber = (Application as unknown as { nativeBuildNumber?: string | number }).nativeBuildNumber;
    const connectionText = formatConnectionDiagnostics(connection, {
        version: Application.nativeApplicationVersion || 'unknown',
        build: String(nativeBuildNumber ?? '0'),
        deviceCode: supportCode,
    });
    const handleCopyConnection = () => { void copyConnectionDiagnostics(connectionText); };

    const languages = tArray<{ code: string; name: string }>('settings.languages');

    return (
        <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]}>
            <View style={styles.header}>
                <Ionicons name="settings-outline" size={24} color={themeColors.onSurface} />
                <Text style={[styles.title, { color: themeColors.onSurface }]}>{i18n.t('settings.title')}</Text>
            </View>

            {/* Theme */}
            <View style={[styles.section, { backgroundColor: themeColors.surfaceAlt }]}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="moon-outline" size={20} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.onSurface }]}>{i18n.t('settings.theme')}</Text>
                </View>

                <Text style={[styles.rowLabel, { color: themeColors.textSecondary }]}>{i18n.t('settings.mode')}</Text>
                <View style={styles.themeOptions}>
                    {MODE_OPTIONS.map(({ mode, Icon, labelKey }) => {
                        const isSelected = theme === mode;
                        return (
                            <TouchableOpacity
                                key={mode}
                                style={[
                                    styles.themeBtn,
                                    { borderColor: isSelected ? themeColors.accent : themeColors.border },
                                    isSelected && { backgroundColor: themeColors.accent },
                                ]}
                                onPress={() => setTheme(mode)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isSelected }}
                            >
                                <Ionicons name={Icon} size={20} color={isSelected ? themeColors.onAccent : themeColors.textSecondary} />
                                <Text style={[styles.themeBtnText, { color: isSelected ? themeColors.onAccent : themeColors.textSecondary }]}>
                                    {i18n.t(labelKey)}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <Text style={[styles.rowLabel, { color: themeColors.textSecondary, marginTop: 18 }]}>{i18n.t('settings.accent')}</Text>
                <View style={styles.accentDots}>
                    {(Object.keys(accents) as AccentType[]).map((key) => (
                        <TouchableOpacity
                            key={key}
                            accessibilityLabel={accents[key].label}
                            accessibilityRole="button"
                            accessibilityState={{ selected: accent === key }}
                            style={[
                                styles.accentDot,
                                { backgroundColor: accents[key].accent },
                                accent === key && { borderColor: themeColors.onSurface, borderWidth: 2 },
                            ]}
                            onPress={() => setAccent(key)}
                        />
                    ))}
                </View>
            </View>

            {/* Language */}
            <View style={[styles.section, { backgroundColor: themeColors.surfaceAlt }]}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="globe-outline" size={20} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.onSurface }]}>{i18n.t('settings.language')}</Text>
                </View>
                <View style={styles.langList}>
                    {languages.map((lang) => {
                        const isSelected = locale === lang.code;
                        return (
                            <TouchableOpacity
                                key={lang.code}
                                style={[
                                    styles.langOption,
                                    {
                                        borderColor: isSelected ? themeColors.accent : themeColors.border,
                                        backgroundColor: isSelected ? themeColors.accent : themeColors.surfaceAlt,
                                    },
                                ]}
                                onPress={() => {
                                    setLocale(lang.code);
                                }}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isSelected }}
                            >
                                <Text
                                    style={[
                                        styles.langText,
                                        { color: isSelected ? themeColors.onAccent : themeColors.textSecondary },
                                    ]}
                                >
                                    {lang.name}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>

            {/* Telegram invite */}
            <TouchableOpacity
                style={[
                    styles.section,
                    styles.telegramBtn,
                    { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.border },
                ]}
                onPress={() => void joinTelegram()}
                accessibilityRole="link"
                accessibilityLabel={i18n.t('settings.telegram')}
                activeOpacity={0.7}
            >
                <Ionicons name="send-outline" size={20} color={themeColors.accent} />
                <Text style={[styles.btnText, { color: themeColors.onSurface }]}>{i18n.t('settings.telegram')}</Text>
            </TouchableOpacity>

            {/* Diagnostics — connection and data snapshot (host only, never a
                full URL, query string or key). Kept in memory; not sent. */}
            <View style={[styles.section, { backgroundColor: themeColors.surfaceAlt }]}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="wifi-outline" size={20} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.onSurface }]}>
                        {i18n.t('settings.connectionData')}
                    </Text>
                </View>
                <Text style={[styles.diagText, { color: themeColors.onSurface }]} numberOfLines={12}>
                    {connectionText}
                </Text>
                <AppButton variant="outline" onPress={handleCopyConnection} style={styles.diagBtn}>
                    {i18n.t('settings.copyConnection')}
                </AppButton>
            </View>

            {/* Diagnostics — last uncaught error (message, stack, route, timestamp).
                Stored in AsyncStorage, never sent anywhere. */}
            <View style={[styles.section, { backgroundColor: themeColors.surfaceAlt }]}>
                <View style={styles.sectionHeader}>
                    <Ionicons name="construct-outline" size={20} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.onSurface }]}>
                        {i18n.t('settings.diagnostics')}
                    </Text>
                </View>
                <Text style={[styles.rowLabel, { color: themeColors.textSecondary }]}>
                    {i18n.t('settings.lastError')}
                </Text>
                <Text style={[styles.diagText, { color: themeColors.onSurface }]} numberOfLines={8}>
                    {lastError
                        ? `${lastError.route}\n${lastError.message}\n${formatLastErrorDetails(lastError).split('\n').slice(1).join('\n')}`
                        : i18n.t('settings.noError')}
                </Text>
                <View style={styles.diagActions}>
                    <AppButton
                        variant="outline"
                        onPress={handleCopyError}
                        style={styles.diagBtn}
                        disabled={lastError == null}
                    >
                        {i18n.t('settings.copyLastError')}
                    </AppButton>
                    <AppButton
                        variant="outline"
                        onPress={handleClearError}
                        style={styles.diagBtn}
                        disabled={lastError == null}
                    >
                        {i18n.t('settings.clearError')}
                    </AppButton>
                </View>
            </View>

            {/* Sign out — outlined so it looks tappable */}
            <TouchableOpacity
                style={[
                    styles.signOutBtn,
                    { borderColor: themeColors.accent, backgroundColor: themeColors.surfaceAlt },
                ]}
                onPress={() => showSignOutConfirm(() => void logout())}
                accessibilityRole="button"
                accessibilityLabel={i18n.t('settings.signOut')}
                activeOpacity={0.7}
            >
                <Ionicons name="log-out-outline" size={20} color={themeColors.accent} />
                <Text style={[styles.btnText, { color: themeColors.accent }]}>{i18n.t('settings.signOut')}</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const getStyles = () => StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 30,
        marginTop: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    section: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 20,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    rowLabel: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 10,
    },
    themeOptions: {
        flexDirection: 'row',
        gap: 12,
    },
    themeBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderWidth: 1,
        borderRadius: 12,
        gap: 6,
    },
    themeBtnText: {
        fontSize: 14,
        fontWeight: '600',
    },
    accentDots: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    accentDot: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    langList: {
        gap: 10,
    },
    langOption: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderRadius: 12,
    },
    langText: {
        fontSize: 16,
        fontWeight: '500',
    },
    telegramBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        borderWidth: 1,
        marginBottom: 0,
    },
    signOutBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 16,
        borderRadius: 16,
        borderWidth: 2,
        marginTop: 20,
        minHeight: 48,
    },
    diagText: {
        fontSize: 11,
        fontWeight: '500',
        fontFamily: 'monospace',
        lineHeight: 16,
        paddingVertical: 10,
    },
    diagActions: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    diagBtn: {
        flex: 1,
    },
    btnText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
