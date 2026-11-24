/**
 * ProgressBar — the design system bar.
 *
 * The fill width is always exactly `value` percent of the measured track
 * (value clamped to 0–100), so a 95% fill really is 95%. One-shot visual
 * change only — no animation loops, no reanimated timing.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { withAlpha } from '../neon/tokens';

export interface ProgressBarProps {
    /** 0–100; values outside the range are clamped. */
    value: number;
    height?: number;
    radius?: number;
    color?: string;
    trackColor?: string;
    style?: StyleProp<ViewStyle>;
    /** Visible percentage label beside the bar. */
    showLabel?: boolean;
    labelStyle?: StyleProp<ViewStyle>;
    accessibilityLabel?: string;
}

export function ProgressBar({
    value,
    height = 8,
    radius = 4,
    color,
    trackColor,
    style,
    showLabel = false,
    labelStyle,
    accessibilityLabel,
}: ProgressBarProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const [trackWidth, setTrackWidth] = useState(0);
    const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
    const fillWidth = trackWidth * (percent / 100);

    return (
        <View style={[styles.row, style]} accessibilityLabel={accessibilityLabel}>
            <View
                style={[
                    styles.track,
                    {
                        height,
                        borderRadius: radius,
                        backgroundColor: trackColor ?? themeColors.surfaceAlt,
                        borderColor: withAlpha(themeColors.accent, 0.25),
                    },
                ]}
                onLayout={(event: LayoutChangeEvent): void => {
                    const width = event.nativeEvent.layout.width;
                    setTrackWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width));
                }}
            >
                <View
                    style={[
                        styles.fill,
                        {
                            width: fillWidth,
                            height,
                            borderRadius: radius,
                            backgroundColor: color ?? themeColors.accent,
                        },
                    ]}
                />
            </View>
            {showLabel ? (
                <Text style={[styles.label, labelStyle, { color: themeColors.text }]}>
                    {`${Math.round(percent)}%`}
                </Text>
            ) : null}
        </View>
    );
}

function getStyles() {
    return StyleSheet.create({
        row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        track: { flexGrow: 1, borderWidth: 1, overflow: 'hidden' },
        fill: { width: 0 },
        label: { fontSize: 11, fontWeight: '700', minWidth: 40, textAlign: 'right' },
    });
}
