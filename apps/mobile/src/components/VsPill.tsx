/**
 * The "VS" pill shown in the match overview header: the kickoff label plus a
 * live countdown when within 24 hours. State label: "LIVE" + score while
 * running, "FT" when finished.
 */

import { Text, View } from 'react-native';
import { useEffect } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

export interface VsPillProps {
    accent: string;
    accentText: string;
    /** Full label text, e.g. "VS — 22:30" / "LIVE • 2 - 1" / "FT". */
    label: string;
    height?: number;
}

export function VsPill({ accent, accentText, label, height = 30 }: VsPillProps) {
    const scale = useSharedValue(0.85);
    useEffect(() => {
        scale.value = withDelay(120, withSpring(1, { mass: 1, damping: 16 }));
        return () => {
            scale.value = 0.85;
        };
    }, []);
    const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    return (
        <Animated.View
            style={[
                {
                    backgroundColor: accent,
                    borderRadius: height / 2,
                    height,
                    paddingHorizontal: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: accent,
                    shadowOpacity: 0.25,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 4,
                },
                animated,
            ]}
        >
            <Text style={{ color: accentText, fontSize: height * 0.45, fontWeight: '800', letterSpacing: 0.5 }}>{label}</Text>
        </Animated.View>
    );
}
