/**
 * Tab bar for the match overview page. Every tab uses the same outline icon
 * in both states; the active tab is shown with accent text and a static neon
 * underline. Tabs are a plain list so new tabs can be appended later.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useTheme } from '../context/ThemeContext';
import { readableAccent, withAlpha } from './neon/tokens';

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
    const { themeColors, isDark } = useTheme();
    const accentInk = readableAccent(themeColors, isDark);

    return (
        <View style={[styles.bar, { borderBottomColor: themeColors.border }]}>
            {tabs.map((tab) => {
                const isActive = active === tab.id;
                const color = isActive ? accentInk : themeColors.mutedText;
                return (
                    <View key={tab.id} style={styles.slot}>
                        <PressScale
                            style={styles.btn}
                            onPress={() => onChange(tab.id)}
                            accessibilityLabel={tab.label}
                        >
                            <tab.Icon color={color} size={17} strokeWidth={isActive ? 2.2 : 1.8} />
                            <Text style={[styles.label, { color }]}>{tab.label}</Text>
                        </PressScale>
                        {isActive ? (
                            <View
                                style={[
                                    styles.underline,
                                    {
                                        backgroundColor: themeColors.accent,
                                        shadowColor: themeColors.accent,
                                        shadowOpacity: isDark ? 0.5 : 0.22,
                                        shadowRadius: 10,
                                        elevation: isDark ? 5 : 1,
                                        borderColor: withAlpha(themeColors.accent, 0.5),
                                    },
                                ]}
                            />
                        ) : null}
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
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    slot: {
        flex: 1,
        alignItems: 'center',
        minHeight: 44,
        justifyContent: 'center',
    },
    btn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 44,
        paddingHorizontal: 8,
    },
    label: { fontSize: 13, fontWeight: '700' },
    underline: {
        position: 'absolute',
        bottom: 0,
        height: 2,
        width: '55%',
        borderRadius: 1,
        borderWidth: 1,
    },
});
