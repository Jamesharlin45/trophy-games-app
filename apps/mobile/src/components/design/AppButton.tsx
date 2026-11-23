/**
 * AppButton — the shared button of the design system.
 *
 * Variants: primary (accent fill), outline, ghost, danger. 52px high, label
 * always centred, optional icon before the text, loading and disabled states.
 * Android ripple is clipped to the button's rounded corners via overflow: hidden.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { onColor, withAlpha } from '../neon/tokens';

export type AppButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

export interface AppButtonProps {
    children: ReactNode;
    variant?: AppButtonVariant;
    onPress?: () => void;
    disabled?: boolean;
    loading?: boolean;
    Icon?: LucideIcon;
    iconSize?: number;
    /** Fill colour override (defaults to the accent, or danger for danger). */
    color?: string;
    radius?: number;
    style?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
    accessibilityRole?: 'button' | 'link';
}

export function AppButton({
    children,
    variant = 'primary',
    onPress,
    disabled = false,
    loading = false,
    Icon,
    iconSize = 16,
    color,
    radius,
    style,
    accessibilityLabel,
    accessibilityRole = 'button',
}: AppButtonProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();

    const isPrimary = variant === 'primary';
    const fill = color ?? (variant === 'danger' ? themeColors.danger : themeColors.accent);
    // onAccent is only for SOLID fills. Ghost/transparent buttons sit on the
    // glass surface, so their label uses readable ink instead.
    const labelColor = variant === 'danger'
        ? onColor(themeColors.danger)
        : isPrimary
            ? (color ? onColor(color) : themeColors.onAccent)
            : variant === 'ghost'
                ? onColor(themeColors.glass)
                : themeColors.onAccent;

    return (
        <View style={[styles.wrap, disabled && styles.disabledWrap, style]}>
            <Pressable
                accessible
                accessibilityRole={accessibilityRole}
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ disabled }}
                android_ripple={{
                    color: withAlpha(labelColor, 0.2),
                    borderless: false,
                }}
                style={[
                    styles.press,
                    {
                        borderRadius: radius ?? 18,
                        backgroundColor: isPrimary || variant === 'outline' ? fill : themeColors.glass,
                        ...(variant === 'primary' ? {} : { borderColor: fill }),
                    },
                    disabled && styles.disabled,
                ]}
                onPress={onPress}
                disabled={disabled}
            >
                {loading ? (
                    <ActivityIndicator size="small" color={labelColor} />
                ) : (
                    <>
                        {Icon ? <Icon size={iconSize} color={labelColor} /> : null}
                        <Text style={[styles.label, { color: labelColor }]}>{children}</Text>
                    </>
                )}
            </Pressable>
        </View>
    );
}

function getStyles() {
    return StyleSheet.create({
        wrap: { alignSelf: 'stretch' },
        press: {
            flexGrow: 1,
            minHeight: 52,
            borderWidth: 1,
            borderRadius: 18,
            overflow: 'hidden',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
            gap: 8,
        },
        label: {
            fontSize: 13,
            fontWeight: '600',
            letterSpacing: 0.4,
        },
        disabledWrap: { opacity: 0.6 },
        disabled: { opacity: 0.55 },
    });
}
