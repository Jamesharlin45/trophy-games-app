import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';
import { Settings, Globe, LogOut, Palette, Moon, Sun, Smartphone } from 'lucide-react-native';
import { accents, type AccentType } from '../theme/colors';
import i18n from '../locales';

const MODE_OPTIONS = [
    { mode: 'light', Icon: Sun, label: 'Light' },
    { mode: 'dark', Icon: Moon, label: 'Dark' },
    { mode: 'system', Icon: Smartphone, label: 'System' },
] as const;

export default function SettingsScreen() {
    const { themeColors, theme, accent, setTheme, setAccent } = useTheme();
    const { locale, setLocale } = useLanguage();

    const languages = [
        { code: 'en', name: 'English' },
        { code: 'fr', name: 'Français' },
        { code: 'es', name: 'Español' },
    ];

    return (
        <ScrollView style={[styles.container, { backgroundColor: themeColors.background }]}>
            <View style={styles.header}>
                <Settings size={24} color={themeColors.text} />
                <Text style={[styles.title, { color: themeColors.text }]}>{i18n.t('settings.title')}</Text>
            </View>

            <View style={[styles.section, { backgroundColor: themeColors.surfaceElevated }]}>
                <View style={styles.sectionHeader}>
                    <Palette size={20} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{i18n.t('settings.theme')}</Text>
                </View>

                <Text style={[styles.rowLabel, { color: themeColors.mutedText }]}>{i18n.t('settings.mode')}</Text>
                <View style={styles.themeOptions}>
                    {MODE_OPTIONS.map(({ mode, Icon, label }) => {
                        const isSelected = theme === mode;
                        return (
                            <TouchableOpacity
                                key={mode}
                                style={[
                                    styles.themeBtn,
                                    { borderColor: themeColors.border },
                                    isSelected && { borderColor: themeColors.accent, backgroundColor: themeColors.accent + '20' },
                                ]}
                                onPress={() => setTheme(mode)}
                            >
                                <Icon size={20} color={isSelected ? themeColors.accent : themeColors.mutedText} />
                                <Text style={[styles.themeBtnText, { color: isSelected ? themeColors.accent : themeColors.mutedText }]}>{label}</Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <Text style={[styles.rowLabel, { color: themeColors.mutedText, marginTop: 18 }]}>{i18n.t('settings.accent')}</Text>
                <View style={styles.accentDots}>
                    {(Object.keys(accents) as AccentType[]).map((key) => (
                        <TouchableOpacity
                            key={key}
                            accessibilityLabel={accents[key].label}
                            style={[
                                styles.accentDot,
                                { backgroundColor: accents[key].accent },
                                accent === key && { borderColor: themeColors.text, borderWidth: 2 },
                            ]}
                            onPress={() => setAccent(key)}
                        />
                    ))}
                </View>
            </View>

            <View style={[styles.section, { backgroundColor: themeColors.surfaceElevated }]}>
                <View style={styles.sectionHeader}>
                    <Globe size={20} color={themeColors.accent} />
                    <Text style={[styles.sectionTitle, { color: themeColors.text }]}>{i18n.t('settings.language')}</Text>
                </View>
                <View style={styles.langList}>
                    {languages.map((lang) => (
                        <TouchableOpacity
                            key={lang.code}
                            style={[
                                styles.langOption,
                                { borderColor: locale === lang.code ? themeColors.accent : themeColors.border }
                            ]}
                            onPress={() => {
                                setLocale(lang.code);
                            }}
                        >
                            <Text style={[
                                styles.langText,
                                { color: locale === lang.code ? themeColors.accent : themeColors.mutedText }
                            ]}>
                                {lang.name}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            <TouchableOpacity
                style={[styles.btn, { backgroundColor: themeColors.surfaceElevated }]}
                onPress={() => {
                    // Logic to clear user token / username would go here
                    // Then redirect to onboarding
                    // router.replace('/onboarding');
                }}
            >
                <LogOut size={20} color={themeColors.mutedText} />
                <Text style={[styles.btnText, { color: themeColors.mutedText }]}>Sign Out / Change Username</Text>
            </TouchableOpacity>

        </ScrollView>
    );
}

const styles = StyleSheet.create({
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
        gap: 12,
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
    btn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 16,
        borderRadius: 16,
        marginTop: 20,
    },
    btnText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
