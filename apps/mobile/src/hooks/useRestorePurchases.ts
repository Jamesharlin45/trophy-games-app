/**
 * One-shot subscription restore, run when the app starts.
 *
 * Google Play keeps subscriptions attached to the store account, not to the
 * device: after a reinstall the app has no local access token even though the
 * user is still paying. This hook connects to billing once, checks whether the
 * API already knows about an active subscription, and — if not — records every
 * owned subscription via `POST /purchases/record-purchase` (deduped by
 * `purchaseToken` server-side).
 *
 * It is deliberately silent: no alerts, no retries, no loops. Any failure
 * (Expo Go, no Play Store, offline, no purchases) simply ends the attempt.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { Purchase } from 'react-native-iap';
import { ALL_PRODUCT_IDS } from '@trophy-games/shared/subscriptions';
import { api } from '../api/client';
import { getDeviceId } from '../utils/deviceId';

interface BillingModule {
    initConnection: () => Promise<boolean>;
    endConnection: () => Promise<boolean>;
    getAvailablePurchases: () => Promise<Purchase[]>;
}

let billingModule: BillingModule | null = null;
let billingLoaded = false;

/** react-native-iap needs native code, so this throws in Expo Go — ignore. */
function getBillingModule(): BillingModule | null {
    if (billingLoaded) return billingModule;
    billingLoaded = true;
    try {
        billingModule = require('react-native-iap') as BillingModule;
    } catch {
        billingModule = null;
    }
    return billingModule;
}

export function useRestorePurchases(): void {
    const attemptedRef = useRef(false);

    useEffect(() => {
        if (attemptedRef.current) return;
        attemptedRef.current = true;

        // Google Play Billing only exists on Android.
        if (Platform.OS !== 'android') return;

        const mod = getBillingModule();
        if (!mod) return;

        const run = async () => {
            const deviceId = await getDeviceId();
            let connected = false;
            try {
                connected = await mod.initConnection();
                if (!connected) return;

                // If the API already grants access there is nothing to restore.
                const active = await api.purchases.getActiveSubscription(deviceId);
                if (active) return;

                const owned = await mod.getAvailablePurchases();
                for (const item of owned) {
                    if (item.purchaseState !== 'purchased') continue;
                    if (!item.purchaseToken) continue;
                    if (!ALL_PRODUCT_IDS.includes(item.productId)) continue;

                    try {
                        await api.purchases.recordPurchase({
                            deviceId,
                            productId: item.productId,
                            purchaseToken: item.purchaseToken,
                            transactionId: item.transactionId ?? undefined,
                        });
                    } catch {
                        // Silent by design — restoring entitlements must never
                        // surface a network or store error to the user.
                    }
                }
            } catch {
                // Billing unavailable, user cancelled the store prompt, etc.
            } finally {
                if (connected) {
                    try {
                        await mod.endConnection();
                    } catch {
                        // Nothing to do.
                    }
                }
            }
        };

        void run();
    }, []);
}

export default useRestorePurchases;
