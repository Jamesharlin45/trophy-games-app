/**
 * Pulsing placeholder bars that stand in for cards and text while data
 * loads. Respect the system reduce-motion setting.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';

function SkeletonBar({
    style,
    height = 12,
    radius = 10,
    color,
    width,
}: {
    style?: StyleProp<ViewStyle>;
    height?: number;
    radius?: number;
    color?: string;
    width?: number;
}) {
    const { themeColors } = useTheme();
    const motionOff = useReducedMotion();
    const pulse = useSharedValue(0.35);
    useEffect(() => {
        if (motionOff) return;
        pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
        return () => {
            pulse.value = 0.35;
        };
    }, [motionOff]);
    const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
    return (
        <Animated.View
            style={[
                styles.bar,
                { backgroundColor: color ?? themeColors.surfaceElevated, borderRadius: radius, height, width },
                style,
                animated,
            ]}
        />
    );
}

/** A single pulsing bar — pass width via `style={{ width: n }}` or CSS %. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
    return <SkeletonBar style={style} />;
}

export interface SkeletonMatchCardProps {
    /** Padding top of the status row, mirrors the real card header. */
    style?: StyleProp<ViewStyle>;
}

/** Shaped like the list-card in MatchCard (league row, teams, time, tier). */
export function SkeletonMatchCard({ style }: SkeletonMatchCardProps) {
    const { themeColors } = useTheme();
    return (
        <View style={[styles.card, style, { borderColor: themeColors.border }]}>
            <View style={styles.row}>
                <SkeletonBar height={11} width={34} />
                <SkeletonBar height={9} width={140} />
                <SkeletonBar height={26} width={70} />
            </View>
            <View style={styles.teamsRow}>
                <View style={styles.teamCol}>
                    <SkeletonBar height={34} width={34} radius={17} />
                    <SkeletonBar height={10} width={90} />
                </View>
                <View style={styles.teamCol}>
                    <SkeletonBar height={34} width={34} radius={17} />
                    <SkeletonBar height={10} width={90} />
                </View>
            </View>
        </View>
    );
}

export function SkeletonList({ count = 8, style }: { count?: number; style?: StyleProp<ViewStyle> }) {
    return (
        <View style={style}>
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonMatchCard key={i} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: { width: '100%', alignSelf: 'stretch' },
    card: {
        backgroundColor: '#121418',
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 10,
        marginVertical: 6,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    teamsRow: { flexDirection: 'row', gap: 18, alignItems: 'center' },
    teamCol: { flex: 1, alignItems: 'center', gap: 8 },
});
