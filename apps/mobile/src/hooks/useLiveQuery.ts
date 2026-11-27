/**
 * Data-fetching hooks that replace Convex's live queries.
 *
 * - useApiQuery: fetch on mount (or when deps change) and refetch whenever the
 *   app returns to the foreground. Safe to use outside a navigator.
 * - useScreenQuery: same, plus refetch on screen focus and an optional 60s
 *   poll that only runs while the screen is focused and visible.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ApiError, toApiError } from '../api/client';

export interface LiveQueryOptions {
    /** When false the query is not run (used for conditional queries). */
    enabled?: boolean;
    /** Poll interval in milliseconds. Only used by useScreenQuery. */
    pollMs?: number;
}

export interface LiveQueryResult<T> {
    data: T | undefined;
    error: ApiError | null;
    /** True until the first request for the current query settles. */
    loading: boolean;
    /** True once at least one request has settled (success or failure). */
    loaded: boolean;
    refetch: () => Promise<void>;
}

/**
 * A screen may never leave its skeleton if the network promise never settles
 * (dead connection, hanging proxy, native fetch that ignores AbortController).
 * After this long we surface an error state with Retry instead. The HTTP layer
 * itself has a longer timeout; this is the UI's no-blank guarantee.
 */
export const QUERY_TIMEOUT_MS = 8000;

interface InternalOptions extends LiveQueryOptions {
    /**
     * Skip the mount fetch. Used by useScreenQuery, whose focus effect fires
     * immediately on mount and performs the first request.
     */
    deferInitial?: boolean;
}

export function useApiQuery<T>(
    fetcher: () => Promise<T>,
    deps: DependencyList,
    options: InternalOptions = {},
): LiveQueryResult<T> {
    const { enabled = true, pollMs, deferInitial = false } = options;

    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    const mountedRef = useRef(true);
    const requestIdRef = useRef(0);
    const firstRunRef = useRef(true);

    const [data, setData] = useState<T | undefined>(undefined);
    const [error, setError] = useState<ApiError | null>(null);
    const [loading, setLoading] = useState<boolean>(enabled);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const run = useCallback(async () => {
        if (!enabledRef.current) return;

        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
                () => reject(new ApiError('Request timed out', 'timeout')),
                QUERY_TIMEOUT_MS,
            );
        });

        try {
            const result = await Promise.race([fetcherRef.current(), timeoutPromise]);
            if (!mountedRef.current || requestId !== requestIdRef.current) return;
            setData(result);
            setError(null);
        } catch (caught) {
            if (!mountedRef.current || requestId !== requestIdRef.current) return;
            setError(toApiError(caught));
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
            if (mountedRef.current && requestId === requestIdRef.current) {
                setLoading(false);
                setLoaded(true);
            }
        }
    }, []);

    const refetch = useCallback(async () => {
        await run();
    }, [run]);

    // Initial load and re-load when the query arguments change.
    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        if (deferInitial && firstRunRef.current) {
            firstRunRef.current = false;
            setLoading(true);
            return;
        }
        firstRunRef.current = false;
        setLoading(true);
        void run();
        // The caller's deps describe the query arguments.
    }, [enabled, deferInitial, run, ...deps]);

    // Refetch when the app comes back to the foreground.
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
            if (state === 'active') void run();
        });
        return () => subscription.remove();
    }, [run]);

    // Optional polling for non-screen consumers.
    useEffect(() => {
        if (!enabled || !pollMs || pollMs <= 0) return;
        const interval = setInterval(() => {
            void run();
        }, pollMs);
        return () => clearInterval(interval);
    }, [enabled, pollMs, run]);

    return { data, error, loading, loaded, refetch };
}

export function useScreenQuery<T>(
    fetcher: () => Promise<T>,
    deps: DependencyList,
    options: LiveQueryOptions = {},
): LiveQueryResult<T> {
    const { enabled = true, pollMs } = options;
    const query = useApiQuery(fetcher, deps, { enabled, deferInitial: true });

    useFocusEffect(
        useCallback(() => {
            if (!enabled) return;

            void query.refetch();

            let interval: ReturnType<typeof setInterval> | undefined;
            if (pollMs && pollMs > 0) {
                interval = setInterval(() => {
                    // Poll only while the app is actually in the foreground.
                    if (AppState.currentState === 'active') {
                        void query.refetch();
                    }
                }, pollMs);
            }

            return () => {
                if (interval !== undefined) clearInterval(interval);
            };
        }, [enabled, pollMs, query.refetch]),
    );

    return query;
}
