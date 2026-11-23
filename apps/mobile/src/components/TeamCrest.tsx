/**
 * TeamCrest — badge/crest for teams.
 *
 * Design system: the ring is ALWAYS neutral (themeColors.border) so it
 * survives every theme. A missing or broken logo becomes a neutral circle
 * with the team's two-letter initials — never a solid accent colour.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

export interface TeamCrestProps {
    uri?: string;
    name?: string;
    size: number;
    /** Unused today — kept for API compatibility. Rings are neutral. */
    teamColor?: string;
    /** Kept for API compatibility; the neutral fallback circle is used. */
    fallbackColors?: [string, string];
}

export function TeamCrest({ uri, name, size }: TeamCrestProps) {
    const { themeColors } = useTheme();
    const [failed, setFailed] = useState(false);

    const safeName = String(name ?? '');
    const initials = safeName
        .split(' ')
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase();

    const logoUri = uri && !failed ? uri : undefined;
    const radius = size / 2;
    const styles = getStyles(themeColors);

    const crestStyle = [
        styles.crest,
        {
            width: size,
            height: size,
            borderWidth: Math.max(1, size / 12),
            borderRadius: radius,
        },
    ];

    if (logoUri) {
        return (
            <View style={crestStyle}>
                <Image
                    source={{ uri: logoUri }}
                    style={{ width: size, height: size, resizeMode: 'contain' }}
                    onError={() => setFailed(true)}
                />
            </View>
        );
    }

    return (
        <View style={crestStyle}>
            {initials ? (
                <Text
                    style={[
                        styles.initials,
                        { color: themeColors.onSurface, fontSize: Math.max(8, size * 0.4) },
                    ]}
                >
                    {initials}
                </Text>
            ) : null}
        </View>
    );
}

function getStyles(themeColors: ReturnType<typeof useTheme>['themeColors']) {
    return StyleSheet.create({
        crest: {
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            backgroundColor: themeColors.surfaceAlt,
            borderColor: themeColors.border,
        },
        initials: {
            fontWeight: '800',
            letterSpacing: -0.5,
        },
    });
}
