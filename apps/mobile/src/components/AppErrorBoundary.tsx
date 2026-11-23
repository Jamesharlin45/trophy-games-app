/**
 * AppErrorBoundary — safety net that keeps the app on screen when a screen
 * render throws (a bug that used to take the whole app down). On error it
 * shows a friendly fallback screen with Back, Retry and "Copy error details"
 * buttons and stores the error in diagnostics (see lib/errorDiagnostics.ts).
 */

import { Component } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { formatLastErrorDetails, storeLastError } from '../lib/errorDiagnostics';
import { setStringAsync } from 'expo-clipboard';
import i18n from '../locales';

interface AppErrorBoundaryState {
    error: unknown;
    /** Bumped on every reset so the children remount from scratch. */
    resetKey: number;
}

class ErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
    state: AppErrorBoundaryState = { error: null, resetKey: 0 };

    static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
        return { error, resetKey: 0 };
    }

    componentDidCatch(error: unknown): void {
        console.error('[AppErrorBoundary]', error);
        void storeLastError(error);
    }

    reset = (): void => {
        this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
    };

    render(): ReactNode {
        const { error, resetKey } = this.state;
        if (error != null) {
            return <FallbackScreen key={resetKey} error={error} onRetry={this.reset} />;
        }
        return <View key={resetKey}>{this.props.children}</View>;
    }
}

function textFor(key: string, fallback: string): string {
    const value = i18n.t(key);
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function FallbackScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
    const router = useRouter();
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const message = error instanceof Error ? error.message : String(error);

    const copyDetails = async () => {
        const details = formatLastErrorDetails({ message, route: 'unknown', timestamp: Date.now() });
        if (details) await setStringAsync(details);
    };

    return (
        <SafeAreaView style={styles.container} edges={['left', 'right']}>
            <View style={styles.wrap}>
                <Ionicons name="alert-circle-outline" size={28} color={themeColors.accent} />
                <Text style={[styles.title, { color: themeColors.onSurface }]}>
                    {textFor('error.boundaryTitle', 'Something went wrong')}
                </Text>
                <Text style={[styles.body, { color: themeColors.textSecondary }]} numberOfLines={6}>
                    {textFor('error.boundaryBody', 'This screen could not be loaded. You can try again, or go back.')}
                </Text>
                {message ? (
                    <Text style={[styles.message, { color: themeColors.textSecondary }]} numberOfLines={4}>
                        {message}
                    </Text>
                ) : null}
                <View style={styles.ctaRow}>
                    <AppButtonInternal onPress={() => router.back()} style={styles.cta}>
                        {textFor('common.goBack', 'Go back')}
                    </AppButtonInternal>
                    <AppButtonInternal onPress={onRetry} style={styles.cta}>
                        {textFor('common.retry', 'Retry')}
                    </AppButtonInternal>
                    <AppButtonInternal onPress={() => void copyDetails()} style={styles.cta}>
                        {textFor('error.copyDetails', 'Copy error details')}
                    </AppButtonInternal>
                </View>
            </View>
        </SafeAreaView>
    );
}

// Local AppButton wrapper so the fallback screen doesn't depend on the
// match page's styles/props (app boundary should work standalone).
import { AppButton } from './design/AppButton';
import type { StyleProp, ViewStyle } from 'react-native';

function AppButtonInternal({ onPress, style, children }: { onPress: () => void; style?: StyleProp<ViewStyle>; children: ReactNode }) {
    return <AppButton onPress={onPress} style={style}>{children}</AppButton>;
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: themeColors.background },
        wrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
        title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
        body: { fontSize: 14, textAlign: 'center' },
        message: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
        ctaRow: { flexDirection: 'row', gap: 10, width: '100%' },
        cta: { flex: 1 },
    });
}

export { ErrorBoundary as AppErrorBoundary };
