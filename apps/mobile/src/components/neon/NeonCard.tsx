/**
 * NeonCard — the base surface for match cards, panels and dialog cards.
 * Dark neon: 1px accent border (42% opacity) + soft accent glow on every
 * theme/accent. Light mode uses the same border with a reduced glow.
 */

import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { NEON_RADIUS, neonBorder, neonShadow } from './tokens';

export interface NeonCardProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    /** Border radius; defaults to 18px. */
    radius?: number;
    /** Slightly stronger border/glow for the currently selected item. */
    selected?: boolean;
    /** Set false when the child controls its own padding. */
    padded?: boolean;
    accessibilityLabel?: string;
}

export function NeonCard({
    children,
    style,
    radius = NEON_RADIUS,
    selected = false,
    padded = true,
    accessibilityLabel,
}: NeonCardProps) {
    const { themeColors, isDark } = useTheme();
    const styles = getStyles(themeColors);

    return (
        <View
            style={[
                styles.card,
                {
                    borderRadius: radius,
                    borderColor: neonBorder(themeColors.accent, selected),
                    ...neonShadow(themeColors.accent, isDark, selected),
                },
                padded && styles.padded,
                selected && styles.selected,
                style,
            ]}
            accessibilityLabel={accessibilityLabel}
        >
            {children}
        </View>
    );
}

function getStyles(themeColors: ReturnType<typeof useTheme>['themeColors']) {
    return StyleSheet.create({
        card: {
            backgroundColor: themeColors.surface,
            borderWidth: 1,
        },
        padded: {
            paddingHorizontal: 16,
            paddingVertical: 14,
        },
        selected: {
            backgroundColor: themeColors.surfaceElevated,
        },
    });
}
