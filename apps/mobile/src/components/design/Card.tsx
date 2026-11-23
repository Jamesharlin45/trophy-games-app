/**
 * Card — the base surface of the design system. Opaque (no alpha), 1px theme
 * border, radius 16–20. Used for match rows, panels, plan cards, dialogs.
 */

import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { neonAccentBorder, neonShadow } from '../neon/tokens';

export interface CardProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    /** Border radius; defaults to 16px. */
    radius?: number;
    /** Slightly stronger accent border + glow for the currently selected item. */
    selected?: boolean;
    /** Set false when the child controls its own padding. */
    padded?: boolean;
    accessibilityLabel?: string;
}

export function Card({
    children,
    style,
    radius = 16,
    selected = false,
    padded = true,
    accessibilityLabel,
}: CardProps) {
    const { themeColors, isDark } = useTheme();
    const styles = getStyles(themeColors);

    return (
        <View
            style={[
                styles.card,
                {
                    borderRadius: radius,
                    borderColor: selected
                        ? neonAccentBorder(themeColors, isDark, true)
                        : neonAccentBorder(themeColors, isDark),
                    ...neonShadow(themeColors, isDark, selected),
                },
                padded && styles.padded,
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
    });
}
