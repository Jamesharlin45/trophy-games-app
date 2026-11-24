/**
 * Animated splash: the app icon scales and glows in once, then the splash
 * fades into the Home screen. Reduce motion skips straight to the app.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withTiming,
} from 'react-native-reanimated';
import SplashLogo from '../../assets/images/logo.png';
import { useTheme } from '../context/ThemeContext';
import { withAlpha } from './neon/tokens';
import i18n from '../locales';

export default function SplashAnim({ onDone }: { onDone: () => void }) {
    const brand = i18n.t('splash.brand');
    const { themeColors } = useTheme();
    const reduceMotion = useReducedMotion();

    const iconScale = useSharedValue(0.72);
    const glow = useSharedValue(0);
    const brandOpacity = useSharedValue(0);
    const exit = useSharedValue(1);

    useEffect(() => {
        if (reduceMotion) {
            iconScale.value = 1;
            glow.value = 0.85;
            brandOpacity.value = 1;
            exit.value = 0;
            onDone();
            return undefined;
        }

        iconScale.value = withTiming(1, { duration: 180 });
        glow.value = withDelay(80, withTiming(0.85, { duration: 180 }));
        brandOpacity.value = withDelay(100, withTiming(1, { duration: 180 }));
        const timer = setTimeout(() => {
            exit.value = withTiming(0, { duration: 180 }, () => runOnJS(onDone)());
        }, 500);
        return () => clearTimeout(timer);
    }, [onDone, reduceMotion, iconScale, glow, brandOpacity, exit]);

    const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));
    const glowStyle = useAnimatedStyle(() => ({
        opacity: glow.value,
        transform: [{ scale: 0.92 + glow.value * 0.08 }],
    }));
    const brandStyle = useAnimatedStyle(() => ({ opacity: brandOpacity.value }));
    const exitStyle = useAnimatedStyle(() => ({ opacity: exit.value }));

    return (
        <Animated.View style={[styles.container, { backgroundColor: themeColors.background }, exitStyle]}>
            <View style={styles.glowWrap}>
                <Animated.View
                    style={[
                        styles.glow,
                        { backgroundColor: withAlpha(themeColors.accent, 0.3) },
                        glowStyle,
                    ]}
                />
            </View>
            <Animated.Image source={SplashLogo} style={[styles.icon, iconStyle]} resizeMode="contain" />
            <Animated.View style={[styles.brand, brandStyle]}>
                <Text style={[styles.brandText, { color: themeColors.text }]}>{brand}</Text>
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
    },
    glowWrap: { alignItems: 'center' },
    glow: {
        width: 150,
        height: 150,
        borderRadius: 75,
    },
    icon: { width: 78, height: 78 },
    brand: { marginTop: 10 },
    brandText: { fontSize: 22, fontWeight: '700', letterSpacing: 0.5 },
});
