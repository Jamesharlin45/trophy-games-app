import { useState, useEffect, useRef } from 'react';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface PushNotificationState {
    expoPushToken?: Notifications.ExpoPushToken;
    notification?: Notifications.Notification;
}

/**
 * Push notifications are best-effort. Every native call is wrapped so a
 * missing module, a denied permission or a rejected registration can never
 * escape as an unhandled rejection during startup.
 */
export const usePushNotifications = (): PushNotificationState => {
    const [expoPushToken, setExpoPushToken] = useState<
        Notifications.ExpoPushToken | undefined
    >();

    const [notification, setNotification] = useState<
        Notifications.Notification | undefined
    >();

    const notificationListener = useRef<Notifications.EventSubscription | undefined>(undefined);
    const responseListener = useRef<Notifications.EventSubscription | undefined>(undefined);

    useEffect(() => {
        try {
            Notifications.setNotificationHandler({
                handleNotification: async () => ({
                    shouldPlaySound: true,
                    shouldShowAlert: true,
                    shouldSetBadge: true,
                    shouldShowBanner: true,
                    shouldShowList: true,
                }),
            });
        } catch (error) {
            console.warn('Unable to install the notification handler:', error);
        }

        const registerForPushNotificationsAsync = async () => {
            let token: Notifications.ExpoPushToken | undefined;

            try {
                if (Platform.OS === 'android') {
                    await Notifications.setNotificationChannelAsync('default', {
                        name: 'default',
                        importance: Notifications.AndroidImportance.MAX,
                        vibrationPattern: [0, 250, 250, 250],
                        lightColor: '#ffbb00',
                    }).catch(() => {
                        // A missing channel only affects notification styling.
                    });
                }

                if (Device.isDevice) {
                    const { status: existingStatus } =
                        await Notifications.getPermissionsAsync();
                    let finalStatus = existingStatus;
                    if (existingStatus !== 'granted') {
                        const { status } = await Notifications.requestPermissionsAsync();
                        finalStatus = status;
                    }
                    if (finalStatus !== 'granted') {
                        return undefined;
                    }

                    try {
                        const projectId =
                            Constants?.expoConfig?.extra?.eas?.projectId ??
                            Constants?.easConfig?.projectId;
                        token = await Notifications.getExpoPushTokenAsync({
                            projectId,
                        });
                    } catch (e) {
                        console.warn('Failed to get expo push token:', e);
                    }
                }
            } catch (error) {
                // Permissions/device APIs unavailable — push is optional.
                console.warn('Push notification registration unavailable:', error);
            }

            return token;
        };

        void registerForPushNotificationsAsync()
            .then((token) => { setExpoPushToken(token); })
            .catch(() => {
                // Push token is best-effort — never crash the app for it.
            });

        try {
            notificationListener.current =
                Notifications.addNotificationReceivedListener((received) => {
                    setNotification(received);
                });
        } catch (error) {
            console.warn('Unable to listen for notifications:', error);
        }

        try {
            responseListener.current =
                Notifications.addNotificationResponseReceivedListener(() => {
                    // Handle notification tap
                });
        } catch (error) {
            console.warn('Unable to listen for notification responses:', error);
        }

        return () => {
            try {
                notificationListener.current?.remove();
            } catch {
                // Ignore cleanup failures.
            }
            try {
                responseListener.current?.remove();
            } catch {
                // Ignore cleanup failures.
            }
        };
    }, []);

    return {
        expoPushToken,
        notification,
    };
};
