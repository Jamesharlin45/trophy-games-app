/**
 * Pill — compact status / tier / result label (design system `Pill`).
 *
 * Filled pills use the onAccent token for text (onAccent is only valid on a
 * SOLID accent fill). Outline/transparent pills use the readable ink for the
 * pill's surface — onColor(fill) on glass, so the label is readable in every
 * theme and accent.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { neonAccentBorder, onColor, withAlpha } from '../neon/tokens';

export type PillTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface PillProps {
    label: string;
    tone?: PillTone;
    /** Solid fill. Text switches to the onAccent token. */
    filled?: boolean;
    Icon?: LucideIcon;
    iconSize?: number;
    /** Static dot shown before the label (LIVE, selected, …). */
    dot?: boolean;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    numberOfLines?: number;
    accessibilityLabel?: string;
}

export function Pill({
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
}: PillProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const color = toneColor(tone, themeColors);
    // onAccent is only for SOLID accent fills. Outline/transparent pills are
    // readable on their glass surface instead.
    const textColor = filled ? (tone === 'accent' ? themeColors.onAccent : onColor(color)) : onColor(themeColors.glass);

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
                    borderColor: filled ? withAlpha(color, 0.6) : neonAccentBorder(themeColors, false),
                },
                style,
            ]}
            accessibilityLabel={accessibilityLabel ?? label}
        >
            {content}
        </View>
    );
}

function toneColor(tone: PillTone, themeColors: ThemeColors): string {
    switch (tone) {
        case 'info': return themeColors.blue10;
        case 'success': return themeColors.success;
        case 'warning': return themeColors.warning;
        case 'danger': return themeColors.danger;
        case 'neutral': return themeColors.textSecondary;
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
