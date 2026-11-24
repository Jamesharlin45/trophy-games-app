/**
 * EmptyState — the shared "no content yet" screen (lists, sections,
 * searches). Accent icon, bold title, secondary subtitle.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { readableAccent } from '../neon/tokens';

export interface EmptyStateProps {
    /** Icon shown above the copy. */
    Icon?: LucideIcon;
    iconSize?: number;
    title: string;
    subtitle?: string;
    /** Optional actions (e.g. retry buttons). */
    children?: ReactNode;
    style?: StyleProp<ViewStyle>;
}

export function EmptyState({ Icon, iconSize = 32, title, subtitle, children, style }: EmptyStateProps) {
    const { themeColors } = useTheme();
    const styles = getStyles();
    const accent = readableAccent(themeColors);

    return (
        <View style={[styles.emptyState, style]}>
            {Icon ? <Icon size={iconSize} color={accent} /> : null}
            <Text style={[styles.title, { color: themeColors.onSurface }]}>{title}</Text>
            {subtitle ? <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>{subtitle}</Text> : null}
            {children ? <View style={styles.actions}>{children}</View> : null}
        </View>
    );
}

function getStyles() {
    return StyleSheet.create({
        emptyState: {
            alignItems: 'center',
            gap: 10,
            paddingVertical: 48,
            paddingHorizontal: 24,
        },
        title: {
            fontSize: 16,
            fontWeight: '700',
            textAlign: 'center',
            lineHeight: 20,
        },
        subtitle: {
            fontSize: 13,
            textAlign: 'center',
            lineHeight: 18,
            paddingHorizontal: 20,
        },
        actions: {
            marginTop: 12,
            flexDirection: 'row',
            gap: 8,
        },
    });
}
