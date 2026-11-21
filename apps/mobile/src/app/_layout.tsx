import { useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, Text, Platform, Image } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { Sun, Moon, Bell, Settings } from 'lucide-react-native';
import SplashLogo from '../../assets/images/logo.png';
import i18n from '../locales';
import { ThemeProvider as AppThemeProvider, useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { UserProvider, useUser } from '../context/UserContext';
import { LanguageProvider } from '../context/LanguageContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useRestorePurchases } from '../hooks/useRestorePurchases';
import { useApiQuery } from '../hooks/useLiveQuery';
import { api } from '../api/client';
import SplashAnim from '../components/SplashAnim';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const [loaded] = useFonts({});

    if (!loaded) {
        return null;
    }

    return (
        <SafeAreaProvider>
            <AppThemeProvider>
                <LanguageProvider>
                    <UserProvider>
                        <RootLayoutContent />
                    </UserProvider>
                </LanguageProvider>
            </AppThemeProvider>
        </SafeAreaProvider>
    );
}

function RootLayoutContent() {
    const [splashDone, setSplashDone] = useState(false);

    const handleSplashDone = useCallback(() => {
        SplashScreen.hideAsync().catch(() => {});
        setSplashDone(true);
    }, []);

    if (!splashDone) {
        return <SplashAnim onDone={handleSplashDone} />;
    }

    return <AppContent />;
}

function AppContent() {
    const router = useRouter();
    const { theme, isDark, themeColors, toggleTheme } = useTheme();
    const { username, isLoading: isUserLoading } = useUser();
    const { expoPushToken } = usePushNotifications();
    const insets = useSafeAreaInsets();
    const styles = getStyles(themeColors);

    // Restore Google Play subscriptions once, as soon as the app starts.
    useRestorePurchases();

    const [deviceId, setDeviceId] = useState<string | null>(null);

    useEffect(() => {
        if (!isUserLoading && !username) {
            router.replace('/onboarding');
        }
    }, [username, isUserLoading]);

    useEffect(() => {
        const getDeviceId = async () => {
            try {
                const Application = await import('expo-application');
                const id = Application.applicationId + '_' + (Application.nativeApplicationVersion || 'v1');
                setDeviceId(id);
            } catch (e) {
                console.error('Failed to get deviceId:', e);
            }
        };
        void getDeviceId();
    }, []);

    const { data: alerts } = useApiQuery(
        () => api.alerts.getAlerts(deviceId || 'unknown'),
        [deviceId],
    );
    const unreadCount = alerts?.filter((a) => !(a.readBy ?? []).includes(deviceId || 'unknown')).length || 0;

    useEffect(() => {
        const registerToken = async () => {
            if (expoPushToken && deviceId) {
                try {
                    await api.devices.registerPushToken(deviceId, expoPushToken.data);
                } catch (e) {
                    console.error('Failed to register push token:', e);
                }
            }
        };
        void registerToken();
    }, [expoPushToken, deviceId]);

    // Configure Android navigation bar to match theme
    useEffect(() => {
        if (Platform.OS === 'android') {
            NavigationBar.setBackgroundColorAsync(themeColors.background).catch(() => {});
            NavigationBar.setButtonStyleAsync(isDark ? 'light' : 'dark').catch(() => {});
            NavigationBar.setBorderColorAsync(themeColors.border).catch(() => {});
        }
    }, [isDark, themeColors.background, themeColors.border]);

    return (
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <View style={[styles.container, { backgroundColor: themeColors.background, paddingTop: insets.top }]}>
                <Stack screenOptions={{
                    headerStyle: { backgroundColor: themeColors.background },
                    headerShadowVisible: false,
                    headerTintColor: themeColors.text,
                    headerTitleStyle: {
                        fontWeight: '700',
                        fontSize: 17,
                    },
                    headerLeft: () => (
                        <View style={styles.headerLeft}>
                            <Image source={SplashLogo} style={styles.headerLogo} />
                            <Text style={{ fontWeight: '700', fontSize: 17, color: themeColors.text }}>
                                Trophy Games
                            </Text>
                        </View>
                    ),
                    headerRight: () => (
                        <View style={styles.headerRight}>
                            <TouchableOpacity
                                onPress={() => router.push('/alerts')}
                                style={styles.bellButton}
                            >
                                <Bell size={22} color={themeColors.text} strokeWidth={2.5} />
                                {unreadCount > 0 && (
                                    <View style={[styles.badge, { backgroundColor: themeColors.accent }]}>
                                        <Text style={styles.badgeText}>{unreadCount > 9 ? i18n.t('common.ninePlus') : unreadCount}</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => router.push('/settings')}
                                style={styles.bellButton}
                            >
                                <Settings size={22} color={themeColors.text} strokeWidth={2.5} />
                            </TouchableOpacity>
                            <ThemeToggle onToggle={toggleTheme} currentTheme={theme} themeColors={themeColors} />
                        </View>
                    )
                }}>
                    <Stack.Screen name="(tabs)" options={{
                        headerShown: true,
                        title: '',
                    }} />
                    <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
                    <Stack.Screen name="match/[id]" options={{ headerShown: false }} />
                    <Stack.Screen name="settings" options={{ presentation: 'modal', title: 'Settings', headerShown: false }} />
                    <Stack.Screen name="alerts" options={{ presentation: 'modal', title: 'Alerts' }} />
                    <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
                </Stack>
            </View>
        </ThemeProvider>
    );
}

const ThemeToggle = ({ onToggle, currentTheme, themeColors }: { onToggle: () => void; currentTheme: string; themeColors: ThemeColors }) => {
    const styles = getStyles(themeColors);
    return (
        <TouchableOpacity onPress={onToggle} style={styles.themeToggle} accessibilityRole="button">
            {currentTheme === 'dark' ? (
                <Sun size={20} color={themeColors.accent} />
            ) : (
                <Moon size={20} color={themeColors.accent} />
            )}
        </TouchableOpacity>
    );
};

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        container: {
            flex: 1,
        },
        themeToggle: {
            padding: 12,
        },
        headerLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            padding: 4,
        },
        headerLogo: {
            width: 22,
            height: 22,
            borderRadius: 5,
            tintColor: themeColors.text,
        },
        headerRight: {
            flexDirection: 'row',
            alignItems: 'center',
            marginRight: 8,
        },
        bellButton: {
            padding: 12,
            position: 'relative',
        },
        badge: {
            position: 'absolute',
            top: 8,
            right: 8,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 2,
            borderWidth: 1.5,
            borderColor: themeColors.shadow,
        },
        badgeText: {
            color: themeColors.accentText,
            fontSize: 8,
            fontWeight: '700',
        },
    });
}
