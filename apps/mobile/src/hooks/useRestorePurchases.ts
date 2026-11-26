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
 * It is deliberately quiet: no retries, no loops, and every failure (Expo Go,
 * no Play Store, offline, no purchases) simply ends the attempt. A purchase
 * that *was* restored is reported once through `onRestored` so the UI can
 * confirm it.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { Purchase } from 'react-native-iap';
import { ALL_PRODUCT_IDS, getTierForProduct } from '@trophy-games/shared/subscriptions';
import { api } from '../api/client';
import { getDeviceId } from '../utils/deviceId';

/** A purchase that was re-recorded for this device during the restore. */
export interface RestoredPurchase {
    tier: 'vip' | 'paid';
    productId: string;
    expiresAt?: string;
    /** Needed to offer the backup-token email for this purchase. */
    purchaseToken: string;
    /** True only when this restore created the access token. */
    createdToken: boolean;
}

interface UseRestorePurchasesOptions {
    /** Called once for every purchase the restore managed to re-record. */
    onRestored?: (purchase: RestoredPurchase) => void;
}

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

export function useRestorePurchases(options: UseRestorePurchasesOptions = {}): void {
    const attemptedRef = useRef(false);
    const onRestoredRef = useRef(options.onRestored);
    onRestoredRef.current = options.onRestored;

    useEffect(() => {
        if (attemptedRef.current) return;
        attemptedRef.current = true;

        // Google Play Billing only exists on Android.
        if (Platform.OS !== 'android') return;

        const mod = getBillingModule();
        if (!mod) return;

        const run = async () => {
            let connected = false;
            try {
                if (
                    typeof mod.initConnection !== 'function' ||
                    typeof mod.getAvailablePurchases !== 'function'
                ) {
                    return;
                }

                const deviceId = await getDeviceId();

                connected = await mod.initConnection();
                if (!connected) return;

                // If the API already grants access there is nothing to restore.
                const active = await api.purchases.getActiveSubscription(deviceId);
                if (active) return;

                const owned = await mod.getAvailablePurchases();
                if (!Array.isArray(owned)) return;
                let restored: RestoredPurchase | null = null;
                for (const item of owned) {
                    if (!item || typeof item !== 'object') continue;
                    if (item.purchaseState !== 'purchased') continue;
                    if (typeof item.purchaseToken !== 'string' || !item.purchaseToken) continue;
                    if (typeof item.productId !== 'string' || !ALL_PRODUCT_IDS.includes(item.productId)) continue;

                    try {
                        const result = await api.purchases.recordPurchase({
                            deviceId,
                            productId: item.productId,
                            purchaseToken: item.purchaseToken,
                            transactionId: item.transactionId ?? undefined,
                        });
                        if (result.success) {
                            const tier = result.alreadyRecorded
                                ? getTierForProduct(item.productId)
                                : result.tier;
                            if (tier) {
                                restored = {
                                    tier,
                                    productId: item.productId,
                                    expiresAt: result.alreadyRecorded ? undefined : result.expiresAt,
                                    purchaseToken: item.purchaseToken,
                                    createdToken: !result.alreadyRecorded,
                                };
                            }
                        }
                    } catch {
                        // Silent by design — restoring entitlements must never
                        // surface a network or store error to the user.
                    }
                }
                if (restored) {
                    onRestoredRef.current?.(restored);
                }
            } catch {
                // Billing unavailable, user cancelled the store prompt, etc.
            } finally {
                if (connected && typeof mod.endConnection === 'function') {
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
