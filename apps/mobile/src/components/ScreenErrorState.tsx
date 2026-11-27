/**
 * Visible error terminal state used by every tab screen.
 *
 * A failed (or timed-out) request must never leave a skeleton on screen and
 * must never silently render an empty list that looks like "no matches".
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { AppButton } from './design/AppButton';
import i18n from '../locales';

interface ScreenErrorStateProps {
    message?: string;
    onRetry: () => void;
    style?: StyleProp<ViewStyle>;
}

function textFor(key: string, fallback: string): string {
    const value = i18n.t(key);
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function ScreenErrorState({ message, onRetry, style }: ScreenErrorStateProps) {
    const { themeColors } = useTheme();
    return (
        <View testID="screen-error-state" style={[styles.container, style]}>
            <Text style={[styles.title, { color: themeColors.text }]}>
                {textFor('common.loadFailed', "Couldn't load this screen")}
            </Text>
            <Text style={[styles.body, { color: themeColors.mutedText }]}>
                {message || textFor('common.loadFailedBody', 'Check your connection and try again.')}
            </Text>
            <AppButton onPress={onRetry} accessibilityRole="button">
                {i18n.t('common.retry')}
            </AppButton>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
    },
    title: {
        fontSize: 17,
        fontWeight: '700',
        textAlign: 'center',
    },
    body: {
        fontSize: 14,
        textAlign: 'center',
    },
});
