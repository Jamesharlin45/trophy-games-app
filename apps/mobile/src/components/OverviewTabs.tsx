/**
 * Tab bar for the match overview page. Indicator slides when the active tab
 * changes; fades in once all tabs have been measured. Tabs are given as a
 * plain list, so new tabs can be added later by appending entries.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { PressScale } from './PressScale';
import { useTheme } from '../context/ThemeContext';

export interface TabDef {
    id: string;
    label: string;
    Icon: LucideIcon;
}

export function OverviewTabs({
    tabs,
    active,
    onChange,
}: {
    tabs: TabDef[];
    active: string;
    onChange: (id: string) => void;
}) {
    const { themeColors } = useTheme();
    const [frames, setFrames] = useState<(Readonly<{ left: number; width: number }> | undefined)[]>([]);
    const indX = useSharedValue(0);
    const indW = useSharedValue(0);
    const opacity = useSharedValue(0);
    const animated = useAnimatedStyle(() => ({ left: indX.value, width: indW.value, opacity: opacity.value }));

    const handleLayout = (i: number, layout: { x: number; width: number }) => {
        setFrames((prev) => {
            const next = [...prev];
            next[i] = { left: layout.x, width: layout.width };
            return next;
        });
    };

    useEffect(() => {
        const idx = tabs.findIndex((t) => t.id === active);
        const m = idx >= 0 ? frames[idx] : undefined;
        if (!m) return;
        indX.value = withTiming(m.left, { duration: 300 });
        indW.value = withTiming(m.width, { duration: 300 });
        opacity.value = withTiming(1, { duration: 200 });
    }, [active, tabs, frames, indX, indW, opacity]);

    return (
        <View style={styles.bar}>
            <Animated.View style={[styles.indicator, { backgroundColor: themeColors.accent }, animated]} />
            {tabs.map((tab, i) => {
                const isActive = active === tab.id;
                const color = isActive ? themeColors.accent : themeColors.mutedText;
                return (
                    <View
                        key={tab.id}
                        style={styles.slot}
                        onLayout={(e: LayoutChangeEvent) => handleLayout(i, e.nativeEvent.layout)}
                    >
                        <PressScale style={styles.btn} onPress={() => onChange(tab.id)} accessibilityLabel={tab.label}>
                            <tab.Icon size={17} color={color} fill={isActive ? color : 'none'} />
                            <Text style={[styles.label, { color }]}>{tab.label}</Text>
                        </PressScale>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
    },
    indicator: {
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 2,
        borderRadius: 1,
    },
    slot: { flex: 1, alignItems: 'center' },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    label: { fontSize: 13, fontWeight: '600' },
});
