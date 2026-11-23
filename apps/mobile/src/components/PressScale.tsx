/**
 * Press feedback: scales down 0.98 with a spring on touch and back on release.
 * Always prints feedback? No — respects reduce motion.
 */

import { TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useAnimatedStyle, useSharedValue, useReducedMotion, withTiming } from 'react-native-reanimated';

export interface PressScaleProps {
    style?: StyleProp<ViewStyle>;
    onPress?: () => void;
    onPressIn?: () => void;
    onPressOut?: () => void;
    disabled?: boolean;
    accessibilityRole?: 'button' | 'link';
    accessibilityLabel?: string;
    children: React.ReactNode;
}

export function PressScale({
    style,
    onPress,
    onPressIn,
    onPressOut,
    disabled,
    accessibilityRole = 'button',
    accessibilityLabel,
    children,
}: PressScaleProps) {
    const motionOff = useReducedMotion();
    const scale = useSharedValue(1);
    const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    const handleIn = () => {
        if (!motionOff) scale.value = withTiming(0.98, { duration: 90 });
        onPressIn?.();
    };
    const handleOut = () => {
        if (!motionOff) scale.value = withTiming(1, { duration: 90 });
        onPressOut?.();
    };

    return (
        <TouchableOpacity
            accessible
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            style={[style, animated]}
            onPress={onPress}
            onPressIn={handleIn}
            onPressOut={handleOut}
            disabled={disabled}
        >
            {children}
        </TouchableOpacity>
    );
}
