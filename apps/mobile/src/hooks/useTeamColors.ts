/**
 * Team colours via GET /api/app/team-color?url=<crest url>.
 *
 * - Never blocks rendering: returns the in-memory (and AsyncStorage) cache
 *   immediately, fetches only what is not cached yet, ignores failures
 *   silently so the UI keeps showing the fallback gradient.
 * - Memory cache is the source of truth for the current session;
 *   AsyncStorage entries are warmed into memory at module load.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';

const MEMORY = new Map<string, string>();
const STORAGE_PREFIX = 'team-color:';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
let storageLoad: Promise<void> | null = null;

function isHex(value: string): boolean {
    return HEX_RE.test(value);
}

function storageLoaded(): Promise<void> {
    if (!storageLoad) {
        storageLoad = (async () => {
            try {
                const keys = await AsyncStorage.getAllKeys();
                const teamKeys = keys.filter((k) => k.startsWith(STORAGE_PREFIX));
                if (teamKeys.length > 0) {
                    const entries = await AsyncStorage.multiGet(teamKeys);
                    for (const [key, value] of entries) {
                        if (value === null) continue;
                        const url = key.slice(STORAGE_PREFIX.length);
                        const hex = String(value);
                        if (!url || !isHex(hex)) continue;
                        if (!MEMORY.has(url)) MEMORY.set(url, hex);
                    }
                }
            } catch {
                // Storage unavailable — the in-memory cache still works.
            }
        })();
    }
    return storageLoad;
}

export interface TeamColors {
    /** Dominant team colour of the home team, or undefined while unknown. */
    home?: string;
    /** Dominant team colour of the away team, or undefined while unknown. */
    away?: string;
}

export function useTeamColors(homeLogo?: string, awayLogo?: string): TeamColors {
    const [colors, setColors] = useState<TeamColors>(() => {
        const read = (url?: string): string | undefined => (url ? MEMORY.get(url) : undefined);
        return { home: read(homeLogo), away: read(awayLogo) };
    });

    // Fill in from the persistent cache, then kick off fetches for anything missing.
    useEffect(() => {
        let cancelled = false;
        void storageLoaded().then(() => {
            if (cancelled) return;
            setColors((prev) => {
                const home = homeLogo ? MEMORY.get(homeLogo) : undefined;
                const away = awayLogo ? MEMORY.get(awayLogo) : undefined;
                if (home && prev.home === undefined) {
                    return { ...prev, home };
                }
                if (away && prev.away === undefined) {
                    return { ...prev, away };
                }
                return prev;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [homeLogo, awayLogo]);

    useEffect(() => {
        let cancelled = false;
        const wanted = [homeLogo, awayLogo].filter((u): u is string => Boolean(u));
        void storageLoaded().then(async () => {
            for (const url of wanted) {
                if (cancelled || !url || MEMORY.has(url)) continue;
                try {
                    const result = await api.teamColor(url);
                    const hex = result?.hex;
                    if (!hex || !isHex(hex)) continue;
                    MEMORY.set(url, hex);
                    try {
                        await AsyncStorage.setItem(STORAGE_PREFIX + url, hex);
                    } catch {
                        // Best-effort persistence.
                    }
                    if (cancelled) continue;
                    setColors((prev) => ({
                        ...prev,
                        home: homeLogo === url ? hex : prev.home,
                        away: awayLogo === url ? hex : prev.away,
                    }));
                } catch {
                    // No colour → the caller keeps showing the fallback.
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [homeLogo, awayLogo]);

    return colors;
}
