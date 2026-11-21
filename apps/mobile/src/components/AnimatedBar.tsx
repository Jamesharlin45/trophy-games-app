/**
 * A horizontal progress bar that animates from 0 on mount/change.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';

export function AnimatedBar({
    value,
    height = 6,
    radius = 3,
    color,
    trackColor,
    delay = 250,
    style,
}: {
    value: number;
    height?: number;
    radius?: number;
    color?: string;
    trackColor?: string;
    delay?: number;
    style?: StyleProp<ViewStyle>;
}) {
    const { themeColors } = useTheme();
    const width = useSharedValue(0);
    useEffect(() => {
        const target = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
        width.value = withDelay(delay, withTiming(target, { duration: 500 }));
    }, [value, delay]);

    const animated = useAnimatedStyle(() => ({ width: width.value }));

    return (
        <View style={[styles.track, { backgroundColor: trackColor ?? themeColors.surfaceElevated }, style]}>
            <Animated.View style={[styles.fill, { height, borderRadius: radius, backgroundColor: color ?? themeColors.accent }, animated]} />
        </View>
    );
}

const styles = StyleSheet.create({
    track: { flex: 1, height: 6, overflow: 'hidden', borderRadius: 3 },
    fill: { height: 6, borderRadius: 3 },
});
