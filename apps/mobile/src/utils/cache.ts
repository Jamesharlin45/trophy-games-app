import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = '@bet_titan_cache_';
const DEFAULT_TTL = 3600000; // 1 hour in milliseconds

interface CacheEntry {
    data: unknown;
    timestamp: number;
    ttl: number;
}

/**
 * Reads a cache entry written by this or an older app version. Anything that
 * is not a well-formed entry (corrupted JSON, wrong types, missing fields) is
 * treated as a miss and removed, never thrown at the caller.
 */
function parseEntry(raw: string): CacheEntry | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    const { data, timestamp, ttl } = candidate;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) return null;
    return { data, timestamp, ttl };
}

export const CacheManager = {
    async set(key: string, data: unknown, ttl: number = DEFAULT_TTL) {
        try {
            const cacheData: CacheEntry = {
                data,
                timestamp: Date.now(),
                ttl,
            };
            await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(cacheData));
        } catch (error) {
            console.error('Cache set error:', error);
        }
    },

    async get(key: string) {
        try {
            const cachedString = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
            if (!cachedString) return null;

            const entry = parseEntry(cachedString);
            if (!entry) {
                await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
                return null;
            }

            const isExpired = Date.now() - entry.timestamp > entry.ttl;
            if (isExpired) {
                await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
                return null;
            }

            return entry.data;
        } catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    },

    async clear() {
        try {
            const keys = await AsyncStorage.getAllKeys();
            const cacheKeys = (Array.isArray(keys) ? keys : []).filter(
                (key) => typeof key === 'string' && key.startsWith(CACHE_PREFIX),
            );
            if (cacheKeys.length > 0) {
                await AsyncStorage.multiRemove(cacheKeys);
            }
        } catch (error) {
            console.error('Cache clear error:', error);
        }
    }
};
