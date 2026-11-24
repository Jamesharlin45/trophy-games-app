import { Alert, Linking } from 'react-native';

/** Public Telegram invite, opened from Settings and the locked VIP/Premium screens. */
export const TELEGRAM_URL = 'https://t.me/+7tq9bw_6vXxhM2E0';

/**
 * Opens the Telegram invite. Shows a friendly dialog when it cannot be
 * opened (Linking throws in that case).
 */
export async function joinTelegram(): Promise<void> {
    try {
        await Linking.openURL(TELEGRAM_URL);
    } catch {
        Alert.alert('Telegram', 'Could not open Telegram right now. Please try again.');
    }
}
