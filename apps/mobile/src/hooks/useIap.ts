/**
 * useIap — Google Play Billing hook wrapper for Trophy Games.
 *
 * Wraps react-native-iap's built-in useIAP hook (v15+) and keeps the API's
 * active-subscription state in sync. Restoring subscriptions that already
 * exist on the Google Play account happens once at app start in
 * `useRestorePurchases`.
 *
 * IMPORTANT: Requires a dev client or production build (native code).
 * Expo Go will gracefully show a notice.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type {
    Product,
    ProductSubscription as IapProductSubscription,
    Purchase,
    PurchaseError,
    RequestPurchaseProps,
} from 'react-native-iap';
import { ALL_PRODUCT_IDS } from '@trophy-games/shared/subscriptions';
import { api } from '../api/client';
import { useScreenQuery } from './useLiveQuery';

// ══════════════════════════════════════════════════════════════════
// Lazy-load react-native-iap (may fail in Expo Go / non-native)
// ══════════════════════════════════════════════════════════════════

interface IapUseIapOptions {
    onPurchaseSuccess?: (purchase: Purchase) => void;
    onPurchaseError?: (error: PurchaseError) => void;
}

interface IapUseIapResult {
    connected: boolean;
    products: Product[];
    subscriptions: IapProductSubscription[];
    fetchProducts: (params: { skus: string[]; type?: 'in-app' | 'subs' | 'all' | null }) => Promise<void>;
    getAvailablePurchases: () => Promise<void>;
    requestPurchase: (params: RequestPurchaseProps) => Promise<void>;
}

interface IapModule {
    useIAP: (options?: IapUseIapOptions) => IapUseIapResult;
    getAvailablePurchases: () => Promise<Purchase[]>;
    finishTransaction: (args: { purchase: Purchase; isConsumable: boolean }) => Promise<void>;
}

let iapModule: IapModule | null = null;
let iapLoadError: string | null = null;
let iapLoaded = false;

function getIapModule(): IapModule | null {
    if (iapLoaded) return iapModule;
    iapLoaded = true;
    try {
        iapModule = require('react-native-iap') as IapModule;
    } catch (e) {
        iapLoadError = e instanceof Error ? e.message : String(e);
        console.warn('[useIap] react-native-iap not available:', iapLoadError);
        iapModule = null;
    }
    return iapModule;
}

// ══════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════

export type ActiveSubscription = {
    tier: 'vip' | 'paid';
    productId: string;
    expiresAt: string | undefined;
};

/** Minimal shape matching v15 ProductSubscription.id and displayPrice */
export interface ProductSubscription {
    id: string;
    displayPrice?: string;
    price?: string;
    title?: string;
    description?: string;
    type?: string;
}

interface UseIapOptions {
    deviceId: string;
    onPurchaseSuccess?: (
        tier: 'vip' | 'paid',
        purchaseToken: string,
        productId: string,
    ) => void | Promise<void>;
    onPurchaseError?: (error: string) => void;
}

interface UseIapReturn {
    products: ProductSubscription[];
    activeSubscription: ActiveSubscription | null;
    loading: boolean;
    error: string | null;
    purchase: (productId: string) => Promise<{ success: boolean; reason?: string }>;
    refresh: () => Promise<void>;
}

// ══════════════════════════════════════════════════════════════════
// Hook
// ══════════════════════════════════════════════════════════════════

export function useIap({
    deviceId,
    onPurchaseSuccess,
    onPurchaseError,
}: UseIapOptions): UseIapReturn {
    // ── Lazy-load the IAP module ──
    const mod = getIapModule();
    const useIAP = mod?.useIAP ?? null;
    const iapAvailable = mod !== null && useIAP !== null;

    // Refs for callbacks
    const onPurchaseSuccessRef = useRef(onPurchaseSuccess);
    onPurchaseSuccessRef.current = onPurchaseSuccess;
    const onPurchaseErrorRef = useRef(onPurchaseError);
    onPurchaseErrorRef.current = onPurchaseError;

    // State for no-op fallback
    const [fallbackLoading, setFallbackLoading] = useState(true);

    // API query for the active subscription (works regardless of IAP)
    const {
        data: activeSub,
        refetch: refetchActiveSub,
    } = useScreenQuery(
        () => (deviceId ? api.purchases.getActiveSubscription(deviceId) : Promise.resolve(null)),
        [deviceId],
        { enabled: Boolean(deviceId) },
    );

    // ── Call the real useIAP if available ──
    const iapResult = useIAP
        ? useIAP({
            onPurchaseSuccess: async (purchase: Purchase) => {
                const tier = purchase.productId?.includes('.vip.')
                    ? ('vip' as const)
                    : ('paid' as const);

                try {
                    await onPurchaseSuccessRef.current?.(
                        tier,
                        purchase.purchaseToken || '',
                        purchase.productId || '',
                    );
                } catch (err) {
                    console.error('[useIap] Success handler error:', err);
                }

                try {
                    if (mod) {
                        await mod.finishTransaction({ purchase, isConsumable: false });
                    }
                } catch (err) {
                    console.warn(
                        '[useIap] finishTransaction:',
                        err instanceof Error ? err.message : String(err),
                    );
                }

                // The purchase was recorded by the success handler; refresh so
                // the screen reflects the new entitlement without a remount.
                try {
                    await refetchActiveSub();
                } catch (err) {
                    console.warn(
                        '[useIap] Subscription refresh failed:',
                        err instanceof Error ? err.message : String(err),
                    );
                }
            },
            onPurchaseError: (err: PurchaseError) => {
                onPurchaseErrorRef.current?.(err.message || String(err));
            },
        })
        : null;

    const connected = iapResult?.connected ?? false;
    const products = iapResult?.products ?? [];
    const subscriptions = iapResult?.subscriptions ?? [];
    const fetchProductsFn = iapResult?.fetchProducts;
    const getAvailablePurchasesFn = iapResult?.getAvailablePurchases;
    const requestPurchaseFn = iapResult?.requestPurchase;

    // ── Simulate loading complete for no-op path ──
    useEffect(() => {
        if (!iapAvailable) {
            // Show "loading" briefly, then reveal no-op state
            const t = setTimeout(() => setFallbackLoading(false), 800);
            return () => clearTimeout(t);
        }
    }, [iapAvailable]);

    // ── Fetch subscription products on connect ──
    const [connectTimedOut, setConnectTimedOut] = useState(false);
    useEffect(() => {
        if (connected) {
            setConnectTimedOut(false);
            if (Platform.OS === 'android' && fetchProductsFn) {
                fetchProductsFn({ skus: ALL_PRODUCT_IDS, type: 'subs' }).catch(
                    (e: unknown) => console.warn(
                        '[useIap] fetchProducts failed (SKUs not in Play Console yet?):',
                        e instanceof Error ? e.message : String(e),
                    ),
                );
            }
        }
    }, [connected, fetchProductsFn]);

    // Timeout: if IAP says it's available but never connects, give up after 8s
    useEffect(() => {
        if (!iapAvailable || connected) return;
        const t = setTimeout(() => {
            if (!connected) setConnectTimedOut(true);
        }, 8000);
        return () => clearTimeout(t);
    }, [iapAvailable, connected]);

    // ── Purchase function ──
    const purchase = useCallback(
        async (productId: string) => {
            if (!iapAvailable) {
                return {
                    success: false,
                    reason: 'IAP unavailable. Use a dev build (not Expo Go) for Google Play billing.',
                };
            }

            if (!connected) {
                return {
                    success: false,
                    reason: 'Google Play not connected. Try again in a moment.',
                };
            }

            try {
                // Use the requestPurchase from the module (not via useIAP return,
                // because it's event-based and we handle results via callbacks)
                await requestPurchaseFn?.({
                    request: { google: { skus: [productId] } },
                    type: 'subs',
                });
                return { success: true };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (
                    msg.includes('cancelled') ||
                    msg.includes('cancel') ||
                    msg.includes('user cancelled')
                ) {
                    return { success: false, reason: 'Purchase cancelled' };
                }
                return { success: false, reason: msg };
            }
        },
        [iapAvailable, connected, requestPurchaseFn],
    );

    // ── Refresh ──
    const refresh = useCallback(async () => {
        await refetchActiveSub();
        if (!iapAvailable || !fetchProductsFn) return;
        try {
            await fetchProductsFn({ skus: ALL_PRODUCT_IDS, type: 'subs' });
            if (getAvailablePurchasesFn) await getAvailablePurchasesFn();
        } catch (err) {
            console.warn(
                '[useIap] Refresh error:',
                err instanceof Error ? err.message : String(err),
            );
        }
    }, [iapAvailable, fetchProductsFn, getAvailablePurchasesFn, refetchActiveSub]);

    // ── Computed state ──
    // If IAP module loaded but never connected within timeout, treat as unavailable
    const effectiveAvailable = iapAvailable && !connectTimedOut;
    const loading = effectiveAvailable ? !connected : fallbackLoading;
    const error: string | null = effectiveAvailable
        ? null
        : connectTimedOut
            ? 'Google Play took too long to connect. Falling back to manual access.'
            : `IAP not available. ${iapLoadError || 'Run a dev build for Google Play billing.'}`;

    const activeSubscription: ActiveSubscription | null = activeSub
        ? {
            tier: activeSub.tier,
            productId: activeSub.productId,
            expiresAt: activeSub.expiresAt,
        }
        : null;

    const iapProducts: ProductSubscription[] = (
        subscriptions.length > 0 ? subscriptions : products
    ).map((p) => ({
        id: p.id,
        displayPrice: p.displayPrice,
        title: p.title,
        description: p.description,
        type: p.type,
    }));

    return {
        products: iapProducts,
        activeSubscription,
        loading,
        error,
        purchase,
        refresh,
    };
}

export default useIap;
