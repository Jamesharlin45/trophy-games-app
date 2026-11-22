/**
 * Gentle pulse for primary action buttons: scale 1 → 1.045 with a soft glow,
 * looping ~1.6 s. Stops when the screen is not focused (tracked via
 * useFocusEffect) and honors the system reduce-motion setting.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import { useTheme } from '../context/ThemeContext';

export function AnimatedPulse({
    style,
    onPress,
    children,
    disabled,
    accessibilityRole = 'button',
    accessibilityLabel,
}: {
    style?: StyleProp<ViewStyle>;
    onPress?: () => void;
    children?: React.ReactNode;
    disabled?: boolean;
    accessibilityRole?: 'button' | 'link';
    accessibilityLabel?: string;
}) {
    const motionOff = useReducedMotion();
    const { themeColors } = useTheme();
    const [focused, setFocused] = useState(true);

    useFocusEffect(
        useCallback(() => {
            setFocused(true);
            return () => setFocused(false);
        }, []),
    );

    const pulse = useSharedValue(1);
    const glow = useSharedValue(0);

    useEffect(() => {
        if (motionOff) {
            pulse.value = 1;
            glow.value = 0;
            return;
        }
        if (focused) {
            pulse.value = withRepeat(
                withSequence(withTiming(1.045, { duration: 800 }), withTiming(1, { duration: 800 })),
                -1,
                false,
            );
            glow.value = withRepeat(
                withSequence(withTiming(1, { duration: 800 }), withTiming(0, { duration: 800 })),
                -1,
                false,
            );
        } else {
            pulse.value = withTiming(1, { duration: 300 });
            glow.value = withTiming(0, { duration: 300 });
        }
    }, [focused, motionOff]);

    const animated = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
    const glowStyle = useAnimatedStyle(() => ({
        opacity: glow.value * 0.3,
        backgroundColor: themeColors.text,
    }));

    return (
        <TouchableOpacity
            accessible
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            style={style}
            onPress={onPress}
            disabled={disabled}
        >
            <Animated.View style={[styles.content, animated]}>
                <Animated.View style={[styles.glow, glowStyle]} />
                {children}
            </Animated.View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    glow: {
        position: 'absolute',
        inset: -8,
        borderRadius: 16,
        pointerEvents: 'none',
        shadowColor: '#000000',
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 0 },
    },
});
