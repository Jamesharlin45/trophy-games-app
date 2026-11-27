/**
 * ScreenErrorBoundary — a class error boundary that wraps each tab screen.
 * When a screen throws during render, it shows a friendly message and a
 * Retry button so a bad row can never close the app. Retry remounts the
 * screen (via a bumping key) so state starts fresh.
 */

import { Component } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { storeLastError } from '../lib/errorDiagnostics';

interface ScreenErrorBoundaryProps {
    children: ReactNode;
}

interface ScreenErrorBoundaryState {
    error: unknown;
    /** Bumped on every retry so the children remount from scratch. */
    resetKey: number;
}

class ScreenErrorBoundary extends Component<ScreenErrorBoundaryProps, ScreenErrorBoundaryState> {
    state: ScreenErrorBoundaryState = { error: null, resetKey: 0 };

    static getDerivedStateFromError(error: unknown): ScreenErrorBoundaryState {
        return { error, resetKey: 0 };
    }

    componentDidCatch(error: unknown): void {
        console.error('[ScreenErrorBoundary]', error);
        // Diagnostics must show boundary errors too, not only global JS crashes.
        void storeLastError(error);
    }

    reset = (): void => {
        this.setState((state) => ({ error: null, resetKey: state.resetKey + 1 }));
    };

    render(): ReactNode {
        const { error, resetKey } = this.state;
        if (error !== null) {
            return <ErrorFallback key={resetKey} onRetry={this.reset} error={error} />;
        }
        // Every tab root is `flex: 1`. Without a bounded parent React Native
        // gives that child zero height in a release build, so the screen is
        // mounted but completely blank. This View is the missing bound.
        return <View key={resetKey} style={styles.boundary}>{this.props.children}</View>;
    }
}

function ErrorFallback({ error, onRetry }: { error: unknown; onRetry: () => void }) {
    const { themeColors } = useTheme();
    const message = error instanceof Error && error.message ? error.message : 'The screen could not be loaded.';

    return (
        <View style={[styles.container, { backgroundColor: themeColors.background }]}>
            <Text style={[styles.title, { color: themeColors.text }]}>Something went wrong</Text>
            <Text style={[styles.body, { color: themeColors.textMuted }]}>
                This screen hit an unexpected error. You can try again.
            </Text>
            <Text style={[styles.detail, { color: themeColors.textMuted }]} numberOfLines={6}>
                {message}
            </Text>
            <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: themeColors.primary }]}
                onPress={onRetry}
                activeOpacity={0.8}
            >
                <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
        </View>
    );
}

/** Wraps a screen so its render errors are caught by the boundary. */
export function withErrorBoundary<P extends object>(Component: ComponentType<P>): ComponentType<P> {
    function WrappedScreen(props: P): ReactNode {
        return (
            <ScreenErrorBoundary>
                <Component {...props} />
            </ScreenErrorBoundary>
        );
    }
    return WrappedScreen;
}

export { ScreenErrorBoundary };

const styles = StyleSheet.create({
    boundary: {
        flex: 1,
    },
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
        gap: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
    },
    body: {
        fontSize: 14,
        textAlign: 'center',
    },
    detail: {
        fontSize: 12,
        textAlign: 'center',
    },
    retryButton: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        marginTop: 8,
    },
    retryButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
});
