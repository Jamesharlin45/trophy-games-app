/**
 * LeagueHeader — sticky section header for grouped match lists.
 * Full league name (ellipsis only when it really does not fit), small
 * secondary country and a match count on the right.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { Trophy } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { readableAccent, withAlpha } from './tokens';
import { NeonPill } from './NeonPill';

export interface LeagueHeaderProps {
    league: string;
    country?: string;
    logo?: string;
    count: number;
}

export function LeagueHeader({ league, country, logo, count }: LeagueHeaderProps) {
    const { themeColors, isDark } = useTheme();
    const styles = getStyles(themeColors);

    return (
        <View style={styles.header}>
            {logo ? (
                <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" />
            ) : (
                <View style={[styles.logo, styles.logoFallback]}>
                    <Trophy size={14} color={readableAccent(themeColors, isDark)} />
                </View>
            )}

            <View style={styles.copy}>
                <Text style={[styles.name, { color: themeColors.text }]} numberOfLines={2}>
                    {league}
                </Text>
                {country ? (
                    <Text style={[styles.country, { color: themeColors.mutedText }]} numberOfLines={1}>
                        {country}
                    </Text>
                ) : null}
            </View>

            <NeonPill label={String(count)} tone="neutral" style={styles.count} />
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        header: {
            minHeight: 58,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 18,
            paddingVertical: 10,
            backgroundColor: themeColors.surface,
            borderBottomWidth: 1,
            borderBottomColor: withAlpha(themeColors.accent, 0.35),
        },
        logo: {
            width: 22,
            height: 22,
            borderRadius: 6,
        },
        logoFallback: {
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: withAlpha(themeColors.accent, 0.4),
            backgroundColor: themeColors.glass,
        },
        copy: {
            flex: 1,
            minWidth: 0,
            gap: 2,
        },
        name: {
            fontSize: 14,
            fontWeight: '700',
            lineHeight: 17,
        },
        country: {
            fontSize: 11,
            fontWeight: '600',
            lineHeight: 14,
        },
        count: {
            minWidth: 30,
        },
    });
}
