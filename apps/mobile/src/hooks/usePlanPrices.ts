/**
 * Real Google Play prices for the three subscription plans.
 *
 * The Store screen already loads products through `useIap`, but the launch
 * subscription dialog is shown while the Store tab is still unmounted, so the
 * dialog needs its own source of truth. This module keeps one in-memory copy
 * per app session and fetches it straight from the billing library — never
 * from a hard-coded string, so a plan without a store price simply has no
 * price and callers fall back to the plan name.
 */

import { useCallback, useEffect, useState } from 'react';
import { ALL_PRODUCT_IDS } from '@trophy-games/shared/subscriptions';

/** productId → localised store price, e.g. "KSh 200.00/week". */
export type PlanPrices = Readonly<Record<string, string>>;

const EMPTY: PlanPrices = {};

/** One shared copy for the whole session. */
let cached: PlanPrices | null = null;
let inflight: Promise<PlanPrices> | null = null;

interface StoreProduct {
    id?: string;
    displayPrice?: string;
    price?: string;
}

interface IapBridge {
    initConnection: (config?: unknown) => Promise<boolean>;
    fetchProducts: (request: { skus: string[]; type: 'subs' }) => Promise<StoreProduct[] | null>;
}

/** react-native-iap needs native code, so it is missing in Expo Go. */
function getIap(): IapBridge | null {
    try {
        return require('react-native-iap') as IapBridge;
    } catch {
        return null;
    }
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function fetchOnce(): Promise<PlanPrices | null> {
    const iap = getIap();
    if (!iap) return null;

    // A connection may already be open (restore / Store) — init is idempotent.
    try {
        await iap.initConnection();
    } catch {
        // Fall through: fetchProducts reports a clearer error if it is needed.
    }

    try {
        const products = await iap.fetchProducts({ skus: ALL_PRODUCT_IDS, type: 'subs' });
        const prices: Record<string, string> = {};
        for (const product of products ?? []) {
            if (!product?.id) continue;
            const value = product.displayPrice || product.price;
            if (value) prices[product.id] = value;
        }
        return prices;
    } catch {
        return null;
    }
}

/**
 * Loads the prices once per session. Retries a few times because the
 * launch-time purchase restore can briefly close the billing connection.
 * A failed load is never cached, so `refresh()` can try again later.
 */
async function load(): Promise<PlanPrices> {
    if (cached) return cached;
    if (inflight) return inflight;

    inflight = (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const prices = await fetchOnce();
            if (prices) {
                cached = prices;
                return prices;
            }
            if (attempt < 2) await wait(1200);
        }
        return cached ?? EMPTY;
    })();

    try {
        return await inflight;
    } finally {
        inflight = null;
    }
}

export interface UsePlanPricesResult {
    prices: PlanPrices;
    /** Re-query the store (used when the dialog opens with no prices yet). */
    refresh: () => void;
}

export function usePlanPrices(): UsePlanPricesResult {
    const [prices, setPrices] = useState<PlanPrices>(() => cached ?? EMPTY);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let mounted = true;
        void load().then((result) => {
            if (mounted) setPrices(result);
        });
        return () => {
            mounted = false;
        };
    }, [attempt]);

    const refresh = useCallback(() => {
        setAttempt((value) => value + 1);
    }, []);

    return { prices, refresh };
}

export default usePlanPrices;
