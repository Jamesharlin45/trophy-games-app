/**
 * Badge — result / tier label with the full badge vocabulary of the app:
 * Win (green), Loss (red), Void (grey), Pending (amber), plus Free / VIP /
 * Paid plan badges.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { onColor } from '../neon/tokens';

export type BadgeTone = 'win' | 'lose' | 'void' | 'pending';
export type PlanBadgeTone = 'free' | 'paid' | 'vip';
export type BadgeKind = BadgeTone | PlanBadgeTone;

export interface BadgeProps {
    label: string;
    kind: BadgeKind;
    Icon?: LucideIcon;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    accessibilityLabel?: string;
}

export function Badge({ label, kind, Icon, style, textStyle, accessibilityLabel }: BadgeProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const { color, textColor } = badgeStyle(kind, themeColors);

    return (
        <View
            style={[styles.badge, { backgroundColor: color }, style]}
            accessibilityLabel={accessibilityLabel ?? label}
        >
            {Icon ? <Icon size={11} color={textColor} /> : null}
            <Text style={[styles.text, { color: textColor }, textStyle]}>{label}</Text>
        </View>
    );
}

function badgeStyle(kind: BadgeKind, themeColors: ThemeColors): { color: string; textColor: string } {
    switch (kind) {
        case 'win':
            return { color: themeColors.success, textColor: onColor(themeColors.success) };
        case 'lose':
            return { color: themeColors.danger, textColor: onColor(themeColors.danger) };
        case 'void':
            return { color: themeColors.textSecondary, textColor: themeColors.onSurface };
        case 'pending':
            return { color: themeColors.warning, textColor: onColor(themeColors.warning) };
        case 'free':
            return { color: themeColors.accent, textColor: themeColors.onAccent };
        case 'vip':
            return { color: themeColors.accent, textColor: themeColors.onAccent };
        case 'paid':
            return { color: themeColors.accent, textColor: themeColors.onAccent };
    }
}

function getStyles() {
    return StyleSheet.create({
        badge: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            minHeight: 24,
            paddingHorizontal: 8,
            borderRadius: 12,
            borderWidth: 1,
            alignSelf: 'flex-start',
        },
        text: {
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 0.4,
        },
    });
}
