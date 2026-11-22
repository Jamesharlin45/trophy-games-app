/**
 * NeonPill — compact status / tier / result label.
 * Outline pills keep text on a translucent theme surface; filled pills use
 * the onAccent token for text (or a token with guaranteed contrast).
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { neonBorder, onColor, readableOnSurface, withAlpha } from './tokens';

export type NeonTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface NeonPillProps {
    label: string;
    tone?: NeonTone;
    /** Solid accent/tone fill. Text switches to the onAccent token. */
    filled?: boolean;
    Icon?: LucideIcon;
    iconSize?: number;
    /** Static neon dot shown before the label (LIVE, selected, …). */
    dot?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    numberOfLines?: number;
    accessibilityLabel?: string;
}

export function NeonPill({
    label,
    tone = 'accent',
    filled = false,
    Icon,
    iconSize = 12,
    dot = false,
    style,
    textStyle,
    numberOfLines = 1,
    accessibilityLabel,
}: NeonPillProps) {
    const { themeColors, isDark } = useTheme();
    const styles = getStyles();
    const color = toneColor(tone, themeColors);
    const textColor = filled
        ? tone === 'accent'
            ? themeColors.accentText
            : onColor(color)
        : readableOnSurface(color, themeColors, isDark);

    const content: ReactNode = (
        <>
            {dot ? <View style={[styles.dot, { backgroundColor: textColor }]} /> : null}
            {Icon ? <Icon size={iconSize} color={textColor} /> : null}
            <Text
                style={[styles.label, { color: textColor }, textStyle]}
                numberOfLines={numberOfLines}
            >
                {label}
            </Text>
        </>
    );

    return (
        <View
            style={[
                styles.pill,
                {
                    backgroundColor: filled ? color : themeColors.glass,
                    borderColor: filled ? withAlpha(color, 0.6) : neonBorder(color),
                },
                style,
            ]}
            accessibilityLabel={accessibilityLabel ?? label}
        >
            {content}
        </View>
    );
}

function toneColor(tone: NeonTone, themeColors: ThemeColors): string {
    switch (tone) {
        case 'info': return themeColors.blue10;
        case 'success': return themeColors.success;
        case 'warning': return themeColors.warning;
        case 'danger': return themeColors.danger;
        case 'neutral': return themeColors.mutedText;
        case 'accent':
        default: return themeColors.accent;
    }
}

function getStyles() {
    return StyleSheet.create({
        pill: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            minHeight: 28,
            paddingHorizontal: 9,
            paddingVertical: 4,
            borderRadius: 14,
            borderWidth: 1,
            alignSelf: 'flex-start',
        },
        label: {
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.4,
            flexShrink: 1,
        },
        dot: {
            width: 6,
            height: 6,
            borderRadius: 3,
        },
    });
}
