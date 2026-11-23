/**
 * LeagueHeader — sticky section header for grouped match lists.
 * League logo (22px), full league name (small secondary), country, and a
 * match count on the right. Opaque tokens; neutral border underline.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import type { ThemeColors } from '../../theme/colors';
import { Pill } from '../design/Pill';

export interface LeagueHeaderProps {
    league: string;
    country?: string;
    logo?: string;
    count: number;
}

export function LeagueHeader({ league, country, logo, count }: LeagueHeaderProps) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);

    return (
        <View style={styles.header}>
            {logo ? (
                <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" />
            ) : null}

            <View style={styles.copy}>
                <Text style={[styles.name, { color: themeColors.onSurface }]} numberOfLines={2}>
                    {league}
                </Text>
                {country ? (
                    <Text style={[styles.country, { color: themeColors.textSecondary }]} numberOfLines={1}>
                        {country}
                    </Text>
                ) : null}
            </View>

            <Pill label={String(count)} tone="neutral" style={styles.count} />
        </View>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        header: {
            minHeight: 56,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: themeColors.surfaceAlt,
            borderBottomWidth: 1,
            borderBottomColor: themeColors.border,
        },
        logo: {
            width: 22,
            height: 22,
            borderRadius: 6,
        },
        copy: {
            flex: 1,
            minWidth: 0,
            gap: 2,
        },
        name: {
            fontSize: 15,
            fontWeight: '700',
            lineHeight: 18,
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
