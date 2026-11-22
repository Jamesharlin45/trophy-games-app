/**
 * NeonButton — static neon glow with an Android ripple clipped to the button's
 * rounded corners. No pulsing, breathing or looping animations.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { neonBorder, neonShadow, onColor, readableAccent, withAlpha, NEON_RADIUS } from './tokens';

export interface NeonButtonProps {
    children: ReactNode;
    onPress?: () => void;
    /** Layout style applied to the outer (glow) wrapper. */
    style?: StyleProp<ViewStyle>;
    styleContent?: StyleProp<ViewStyle>;
    /** Fill colour token; defaults to the active accent. */
    color?: string;
    textColor?: string;
    variant?: 'filled' | 'outline';
    radius?: number;
    disabled?: boolean;
    accessibilityRole?: 'button' | 'link';
    accessibilityLabel?: string;
}

export function NeonButton({
    children,
    onPress,
    style,
    styleContent,
    color,
    textColor,
    variant = 'filled',
    radius = NEON_RADIUS,
    disabled = false,
    accessibilityRole = 'button',
    accessibilityLabel,
}: NeonButtonProps) {
    const { themeColors, isDark } = useTheme();
    const styles = getStyles();
    const fill = color ?? themeColors.accent;
    const foreground = textColor ?? (
        variant === 'outline'
            ? readableAccent(themeColors, isDark)
            : fill === themeColors.accent
                ? themeColors.accentText
                : onColor(fill)
    );

    return (
        <View style={[styles.glow, neonShadow(fill, isDark, true), style]}>
            <View
                style={[
                    styles.clip,
                    {
                        borderRadius: radius,
                        backgroundColor: variant === 'filled' ? fill : themeColors.surfaceElevated,
                        borderColor: neonBorder(fill, true),
                    },
                    disabled && styles.disabled,
                ]}
            >
                <Pressable
                    accessible
                    accessibilityRole={accessibilityRole}
                    accessibilityLabel={accessibilityLabel}
                    accessibilityState={{ disabled }}
                    android_ripple={{ color: withAlpha(foreground, 0.18), borderless: false }}
                    style={styles.press}
                    onPress={onPress}
                    disabled={disabled}
                >
                    <View style={[styles.content, styleContent]}>{children}</View>
                </Pressable>
            </View>
        </View>
    );
}

function getStyles() {
    return StyleSheet.create({
        glow: {
            alignSelf: 'stretch',
        },
        clip: {
            flexGrow: 1,
            minHeight: 44,
            borderWidth: 1,
            overflow: 'hidden',
        },
        press: {
            flexGrow: 1,
            minHeight: 44,
            justifyContent: 'center',
        },
        content: {
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 8,
        },
        disabled: {
            opacity: 0.55,
        },
    });
}
