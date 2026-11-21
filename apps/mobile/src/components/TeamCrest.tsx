/**
 * Team crest badge. Shows the team logo image when available, else a country
 * flag (existing behaviour), else bold initials. The background animates from
 * the fallback colour to the real team colour once it arrives.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useEffect, useState } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { readableCopy } from '../lib/colors';
import { getCountryFlagUrl } from '../lib/flags';
import { useTheme } from '../context/ThemeContext';

export interface TeamCrestProps {
    uri?: string;
    name?: string;
    size: number;
    /** Team colour (already hex) from the team-colour service. */
    teamColor?: string;
    /** [fallback primary, fallback secondary] used until the colour arrives. */
    fallbackColors?: [string, string];
}

export function TeamCrest({ uri, name, size, teamColor, fallbackColors }: TeamCrestProps) {
    const { themeColors } = useTheme();
    const [failed, setFailed] = useState(false);

    const safeName = String(name ?? '');
    const initials = safeName
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();

    const fallbackPrimary = fallbackColors?.[0] ?? themeColors.accent;
    const fallbackSecondary = fallbackColors?.[1] ?? themeColors.accent;

    const crestBg = useSharedValue(readableCopy(teamColor) ?? fallbackPrimary);
    const crestBorder = useSharedValue(readableCopy(teamColor) ?? fallbackSecondary);
    useEffect(() => {
        crestBg.value = withTiming(readableCopy(teamColor) ?? fallbackPrimary, { duration: 600 });
        crestBorder.value = withTiming(readableCopy(teamColor) ?? fallbackSecondary, { duration: 600 });
    }, [teamColor, fallbackPrimary, fallbackSecondary]);


    const animated = useAnimatedStyle(() => ({ backgroundColor: crestBg.value, borderColor: crestBorder.value }));

    const logoUri = uri && !failed ? uri : undefined;
    const flagUri = !uri || failed ? getCountryFlagUrl(safeName) : undefined;

    const radius = size / 2;
    const borderWidth = Math.max(1, size / 12);

    if (flagUri) {
        return (
            <View
                style={{
                    width: size,
                    height: size,
                    borderRadius: radius,
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Image source={{ uri: flagUri }} style={{ width: size, height: size, resizeMode: 'contain' }} />
            </View>
        );
    }

    const crestStyle = [
        styles.crest,
        { width: size, height: size, borderWidth: Math.max(1, size / 12) },
        animated,
    ];

    if (logoUri) {
        return (
            <Animated.View style={crestStyle}>
                <Image source={{ uri: logoUri }} style={{ width: size, height: size, resizeMode: 'contain' }} onError={() => setFailed(true)} />
            </Animated.View>
        );
    }

    return (
        <Animated.View style={crestStyle}>
            {initials ? (
                <Text style={{ color: themeColors.accentText, fontSize: size * 0.42, fontWeight: '800' }}>{initials}</Text>
            ) : null}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    crest: {
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        shadowColor: '#000000',
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 5,
    },
});
