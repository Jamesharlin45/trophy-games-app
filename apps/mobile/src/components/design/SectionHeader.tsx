/**
 * SectionHeader — the shared section title shown above groups of rows
 * (wins lists, match details, …). Icon + uppercase label.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { readableAccent } from '../neon/tokens';

export interface SectionHeaderProps {
    /** Label text (shown in caps). */
    title: string;
    /** Optional icon before the label. */
    Icon?: LucideIcon;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
}

export function SectionHeader({ title, Icon, style, textStyle }: SectionHeaderProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();

    return (
        <View style={[styles.header, style]}>
            {Icon ? <Icon size={14} color={readableAccent(themeColors)} /> : null}
            <Text style={[styles.title, { color: themeColors.onSurface }, textStyle]}>
                {title.toUpperCase()}
            </Text>
        </View>
    );
}

function getStyles() {
    return StyleSheet.create({
        header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
        title: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, lineHeight: 14 },
    });
}
