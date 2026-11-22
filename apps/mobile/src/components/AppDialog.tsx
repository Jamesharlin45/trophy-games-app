/**
 * AppDialog — the single dialog shell used everywhere in the app.
 *
 * Behaviour:
 *  - rendered through a React Native `Modal` with `statusBarTranslucent` so the
 *    dimmed backdrop covers the status bar on Android;
 *  - centred card built from theme tokens (surface / border / accent) with a
 *    scale + fade entrance that honours the system reduce-motion setting;
 *  - the Android hardware back button closes it (`onRequestClose`);
 *  - a visible X button closes it, and tapping the backdrop closes it too;
 *  - when `visible` is false React Native unmounts the native modal window, so
 *    a closed dialog never blocks touches underneath it.
 */

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { typography } from '../theme/typography';
import i18n from '../locales';

export interface AppDialogProps {
    /** Drives the native modal window (and therefore touch pass-through). */
    visible: boolean;
    /** Called by the X button, the backdrop and the Android back button. */
    onClose: () => void;
    /** Optional heading rendered above the body. */
    title?: string;
    /** Optional supporting copy rendered under the title. */
    subtitle?: string;
    /** Dialog body. */
    children?: ReactNode;
    /** Optional pinned actions rendered under the body. */
    footer?: ReactNode;
    /** Tapping the dimmed backdrop closes the dialog (default true). */
    dismissOnBackdrop?: boolean;
    /** Show the X button (default true). */
    showClose?: boolean;
    /** Test hook for debugging. */
    testID?: string;
}

export function AppDialog({
    visible,
    onClose,
    title,
    subtitle,
    children,
    footer,
    dismissOnBackdrop = true,
    showClose = true,
    testID,
}: AppDialogProps) {
    const { themeColors } = useTheme();
    const styles = getStyles(themeColors);
    const reducedMotion = useReducedMotion();
    const progress = useSharedValue(0);

    // Re-runs on every opening so the entrance animation replays.
    useEffect(() => {
        if (!visible) return;
        progress.value = 0;
        progress.value = withTiming(1, {
            duration: reducedMotion ? 0 : 220,
            easing: Easing.out(Easing.cubic),
        });
    }, [visible, reducedMotion, progress]);

    const cardStyle = useAnimatedStyle(() => {
        const scale = reducedMotion ? 1 : 0.94 + 0.06 * progress.value;
        return {
            opacity: progress.value,
            transform: [{ scale }],
        };
    });

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            statusBarTranslucent
            hardwareAccelerated
            onRequestClose={onClose}
            testID={testID}
        >
            <Pressable
                style={styles.backdrop}
                onPress={dismissOnBackdrop ? onClose : undefined}
                accessibilityLabel={i18n.t('common.close')}
            >
                {/*
                  The card claims touches that land on it so they never fall
                  through to the backdrop, while deeper touchables (buttons,
                  scroll views) still win the responder negotiation.
                */}
                <Animated.View style={[styles.card, cardStyle]} onStartShouldSetResponder={() => true}>
                    {showClose ? (
                        <TouchableOpacity
                            style={styles.closeBtn}
                            onPress={onClose}
                            hitSlop={12}
                            accessibilityRole="button"
                            accessibilityLabel={i18n.t('common.close')}
                        >
                            <X size={20} color={themeColors.mutedText} />
                        </TouchableOpacity>
                    ) : null}

                    {title ? <Text style={[styles.title, { color: themeColors.text }]}>{title}</Text> : null}
                    {subtitle ? (
                        <Text style={[styles.subtitle, { color: themeColors.mutedText }]}>{subtitle}</Text>
                    ) : null}

                    {children}
                    {footer}
                </Animated.View>
            </Pressable>
        </Modal>
    );
}

function getStyles(themeColors: ThemeColors) {
    return StyleSheet.create({
        backdrop: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.62)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
        },
        card: {
            width: '100%',
            maxWidth: 420,
            maxHeight: '88%',
            backgroundColor: themeColors.surface,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: themeColors.border,
            paddingHorizontal: 20,
            paddingTop: 22,
            paddingBottom: 20,
            gap: 12,
            shadowColor: themeColors.shadow,
            shadowOpacity: 0.4,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 10 },
            elevation: 12,
            overflow: 'hidden',
        },
        closeBtn: {
            position: 'absolute',
            top: 12,
            right: 12,
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: themeColors.glass,
            zIndex: 2,
        },
        title: {
            ...typography.planTitle,
            fontSize: 19,
            textAlign: 'center',
            marginTop: 4,
            paddingHorizontal: 28,
        },
        subtitle: {
            ...typography.body,
            textAlign: 'center',
        },
    });
}

export default AppDialog;
