/**
 * Per-app-user email remembered after a successful VIP/Premium membership
 * request. Used to prefill the email dialog on the next request.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeString } from './safeData';

const REQUEST_EMAIL_KEY = '@trophy_games_request_email';

/** Saved email for the request dialog, or '' when none is stored. */
export async function getRequestEmail(): Promise<string> {
    try {
        return safeString(await AsyncStorage.getItem(REQUEST_EMAIL_KEY));
    } catch {
        return '';
    }
}

/** Persist the email for the next request. Best effort. */
export async function saveRequestEmail(email: string): Promise<void> {
    try {
        const trimmed = email.trim();
        if (trimmed) {
            await AsyncStorage.setItem(REQUEST_EMAIL_KEY, trimmed);
        }
    } catch {
        // Nothing more to do — prefill is a convenience.
    }
}
