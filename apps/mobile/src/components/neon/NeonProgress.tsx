/**
 * NeonProgress — a progress bar whose fill is exactly `value` percent.
 *
 * The old bar animated a raw numeric width, so a value of 95 became 95
 * *points* (roughly half of a wide track). Here the track is measured and the
 * fill width is `trackWidth * percent / 100`. It animates once on mount (or on
 * the first finite value), never loops, and honours reduce motion.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../context/ThemeContext';
import { withAlpha } from './tokens';

export interface NeonProgressProps {
    /** 0–100; values outside the range are clamped. */
    value: number;
    height?: number;
    radius?: number;
    color?: string;
    trackColor?: string;
    style?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
}

export function NeonProgress({
    value,
    height = 8,
    radius = 4,
    color,
    trackColor,
    style,
    accessibilityLabel,
}: NeonProgressProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const reduceMotion = useReducedMotion();
    const [trackWidth, setTrackWidth] = useState(0);
    const fillWidth = useSharedValue(0);
    const hasAnimated = useRef(false);

    const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
    const targetWidth = (trackWidth * percent) / 100;

    useEffect(() => {
        if (trackWidth <= 0) return;
        if (hasAnimated.current || reduceMotion) {
            hasAnimated.current = true;
            fillWidth.value = targetWidth;
            return;
        }
        hasAnimated.current = true;
        fillWidth.value = withTiming(targetWidth, {
            duration: 180,
            easing: Easing.out(Easing.cubic),
        });
    }, [targetWidth, trackWidth, reduceMotion, fillWidth]);

    const animatedStyle = useAnimatedStyle(() => ({ width: fillWidth.value }));

    const onLayout = (event: LayoutChangeEvent): void => {
        setTrackWidth(event.nativeEvent.layout.width);
    };

    return (
        <View
            style={[
                styles.track,
                {
                    height,
                    borderRadius: radius,
                    backgroundColor: trackColor ?? themeColors.surfaceElevated,
                    borderColor: withAlpha(themeColors.accent, 0.25),
                },
                style,
            ]}
            onLayout={onLayout}
            accessibilityLabel={accessibilityLabel}
        >
            <Animated.View
                style={[
                    styles.fill,
                    {
                        height,
                        borderRadius: radius,
                        backgroundColor: color ?? themeColors.accent,
                    },
                    animatedStyle,
                ]}
            />
        </View>
    );
}

function getStyles() {
    return StyleSheet.create({
        track: {
            flexGrow: 1,
            borderWidth: 1,
            overflow: 'hidden',
        },
        fill: {
            width: 0,
        },
    });
}
