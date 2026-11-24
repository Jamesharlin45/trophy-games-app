import '../lib/crashReporter';
import { useEffect, useState, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, Text, Platform, Image } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Stack, useRouter, usePathname } from 'expo-router';
import { Sun, Moon, Bell, Settings } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import AppIconAsset from '../../assets/images/logo.png';
import i18n from '../locales';
import { ThemeProvider as AppThemeProvider, useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { UserProvider, useUser } from '../context/UserContext';
import { DialogProvider } from '../context/DialogContext';
import { LanguageProvider } from '../context/LanguageContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useApiQuery } from '../hooks/useLiveQuery';
import { useRestorePurchases } from '../hooks/useRestorePurchases';
import { getDeviceId } from '../utils/deviceId';
import { api } from '../api/client';
import SplashAnim from '../components/SplashAnim';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { installGlobalErrorHandler, setCurrentRoute } from '../lib/errorDiagnostics';

SplashScreen.preventAutoHideAsync();

// Global JS error handler: stores the last uncaught error (message, stack,
// route, timestamp — no personal data) in AsyncStorage for the Settings
// → Diagnostics screen. Nothing is ever sent anywhere.
installGlobalErrorHandler();

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
    const pathname = usePathname();
    const { theme, isDark, themeColors, toggleTheme } = useTheme();
    // Track the route for diagnostics (stored alongside any caught error).
    useEffect(() => {
        setCurrentRoute(pathname ?? 'unknown');
    }, [pathname]);
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
        let cancelled = false;
        void getDeviceId()
            .then((id) => { if (!cancelled) setDeviceId(id); })
            .catch(() => {});
        return () => { cancelled = true; };
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
        <DialogProvider>
        <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
            <StatusBar style={isDark ? 'light' : 'dark'} />
            <View style={[styles.container, { backgroundColor: themeColors.background, paddingTop: insets.top }]}>
                <AppErrorBoundary>
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
                            <AppIcon size={32} />
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
                </AppErrorBoundary>
            </View>
        </ThemeProvider>
        </DialogProvider>
    );
}

/**
 * The header logo: the app's own icon asset (assets/images/logo.png) at
 * 32px with an 8px radius. When it fails to load (missing/blank
 * placeholder), fall back to an Ionicons trophy in the accent colour.
 */
function AppIcon({ size }: { size: number }) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const [failed, setFailed] = useState(false);

    if (failed) {
        return <Ionicons name="trophy" size={size * 0.6} color={themeColors.accent} style={styles.appIconFallback} />;
    }

    return (
        <Image
            source={AppIconAsset}
            style={[styles.headerLogo, { width: size, height: size }]}
            resizeMode="contain"
            onError={() => setFailed(true)}
        />
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
        errorContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: themeColors.background,
            padding: 24,
        },
        errorTitle: {
            color: themeColors.error,
            fontSize: 18,
            fontWeight: '700',
            marginBottom: 12,
        },
        errorText: {
            color: themeColors.textMuted,
            fontSize: 14,
            textAlign: 'center',
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
            width: 32,
            height: 32,
            borderRadius: 8,
        },
        appIconFallback: {
            alignSelf: 'center',
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
