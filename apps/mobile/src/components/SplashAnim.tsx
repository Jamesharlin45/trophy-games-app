/**
 * Animated splash: the app icon scales and glows in, then the splash fades
 * into the Home screen once the animation ends.
 */

import { Image, Text, View } from 'react-native';
import { useEffect } from 'react';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import SplashLogo from '../assets/images/logo.png';
import i18n from '../locales';

export default function SplashAnim({ onDone }: { onDone: () => void }) {
    const brand = i18n.t('splash.brand');

    const iconScale = useSharedValue(0.55);
    const glow = useSharedValue(0);
    const brandOpacity = useSharedValue(0);
    const exit = useSharedValue(1);

    useEffect(() => {
        iconScale.value = withDelay(
            60,
            withTiming(1, { duration: 320 }, () => {
                glow.value = withDelay(260, withTiming(0.95, { duration: 700 }));
                brandOpacity.value = withDelay(420, withTiming(1, { duration: 320 }));
            }),
        );
        const t = setTimeout(() => {
            exit.value = withTiming(0, { duration: 380 }, () => runOnJS(onDone)());
        }, 1200);
        return () => clearTimeout(t);
    }, [onDone]);

    const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));
    const glowStyle = useAnimatedStyle(() => ({
        opacity: glow.value,
        transform: [{ scale: 0.92 + glow.value * 0.45 }],
    }));
    const brandStyle = useAnimatedStyle(() => ({ opacity: brandOpacity.value }));
    const exitStyle = useAnimatedStyle(() => ({ opacity: exit.value }));

    return (
        <Animated.View style={[styles.container, exitStyle]}>
            <View style={styles.glowWrap}>
                <Animated.View style={[styles.glow, glowStyle]} />
            </View>
            <Animated.Image source={SplashLogo} style={[styles.icon, iconStyle]} resizeMode="contain" />
            <Animated.View style={[styles.brand, brandStyle]}>
                <Text style={styles.brandText}>{brand}</Text>
            </Animated.View>
        </Animated.View>
    );
}

const styles = {
    container: {
        flex: 1,
        backgroundColor: '#0A0C0F',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
    },
    glowWrap: { alignItems: 'center' },
    glow: {
        width: 150,
        height: 150,
        borderRadius: 75,
        backgroundColor: 'rgba(0, 200, 5, 0.30)',
    },
    icon: { width: 78, height: 78 },
    brand: { marginTop: 10 },
    brandText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: 0.5 },
} as const;
