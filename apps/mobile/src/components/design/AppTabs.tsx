/**
 * AppTabs — the shared tab bar (design system `Tabs`).
 *
 * Ionicons outline icons in both states; the active tab is the accent colour
 * with a short accent bar above the icon. Every icon name used here is
 * verified against the installed @expo/vector-icons glyph map.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { PressScale } from '../PressScale';

/** A verified Ionicons icon name. */
export type IonName = NonNullable<ComponentProps<typeof Ionicons>['name']>;

export interface AppTabDef {
    id: string;
    label: string;
    /** Existing Ionicons outline icon name, e.g. 'home-outline'. */
    name: IonName;
}

export interface AppTabsProps {
    tabs: AppTabDef[];
    active: string;
    onChange: (id: string) => void;
    showLabels?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function AppTabs({ tabs, active, onChange, showLabels = true, style }: AppTabsProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();

    return (
        <View style={[styles.bar, style]}>
            {tabs.map((tab) => {
                const isActive = active === tab.id;
                // The active label sits on the surface: it must be readable
                // there (accent isn't guaranteed to be readable on the surface).
                const color = isActive ? themeColors.onSurface : themeColors.textSecondary;
                return (
                    <View key={tab.id} style={styles.slot}>
                        <PressScale
                            style={styles.btn}
                            onPress={() => onChange(tab.id)}
                            accessibilityLabel={tab.label}
                            accessibilityRole="button"
                        >
                            <Ionicons name={tab.name} size={22} color={color} />
                            {showLabels ? <Text style={[styles.label, { color }]}>{tab.label}</Text> : null}
                        </PressScale>
                        {isActive ? <View style={[styles.activeBar, { backgroundColor: themeColors.accent }]} /> : null}
                    </View>
                );
            })}
        </View>
    );
}

function getStyles() {
    return StyleSheet.create({
        bar: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        slot: { flex: 1, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
        btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
        label: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
        activeBar: { height: 3, width: 16, borderRadius: 1.5 },
    });
}
