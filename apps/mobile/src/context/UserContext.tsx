import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { api } from '../api/client';
import { useApiQuery } from '../hooks/useLiveQuery';
import { getDeviceId } from '../utils/deviceId';
import { CacheManager } from '../utils/cache';

const USERNAME_KEY = '@trophy_games_username';
/**
 * Set while signed out. Without it the effect below re-hydrates the username
 * from the server on the next render and immediately bounces the user back
 * into the tabs instead of keeping them on onboarding.
 */
const SIGNED_OUT_KEY = '@trophy_games_signed_out';

interface UserContextType {
  username: string | null;
  setUsername: (username: string | null) => void;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  username: null,
  setUsername: () => {},
  isLoading: true,
  logout: async () => {},
});

/**
 * Older app versions wrote different shapes into this key (JSON blobs,
 * objects stringified by a migration, etc.). Only a plain, plausible
 * username is accepted; anything else falls back to the server value.
 */
function normalizeStoredUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (trimmed === 'null' || trimmed === 'undefined') return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) return null;
  return trimmed;
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [username, setUsernameState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDeviceId().then((id) => {
      if (!cancelled) setDeviceId(id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const { data: remoteUser, loaded } = useApiQuery(
    () => api.users.byDevice(deviceId ?? ''),
    [deviceId],
  );

  useEffect(() => {
    const loadUser = async () => {
      try {
        const signedOut = await AsyncStorage.getItem(SIGNED_OUT_KEY);
        if (signedOut === 'true') {
          // Local sign-out wins over anything the API still knows about.
          setUsernameState(null);
          setIsLoading(false);
          return;
        }

        const stored = normalizeStoredUsername(await AsyncStorage.getItem(USERNAME_KEY));
        if (stored) {
          setUsernameState(stored);
          if (loaded) setIsLoading(false);
        } else if (loaded) {
          // Fallback: if the account exists on the server but not in local
          // storage, sync it back down (unless the user just signed out).
          const remoteUsername = normalizeStoredUsername(remoteUser?.username);
          if (remoteUsername) {
            try {
              await AsyncStorage.setItem(USERNAME_KEY, remoteUsername);
            } catch {
              // The server value is still usable for this session.
            }
            setUsernameState(remoteUsername);
          } else {
            setUsernameState(null);
          }
          setIsLoading(false);
        }
      } catch (e) {
        // Corrupted/unavailable storage must not leave the app stuck on the
        // loading screen. The server result (when it arrives) still wins.
        console.error('Failed to load username', e);
        if (loaded) {
          setUsernameState((current) => current ?? normalizeStoredUsername(remoteUser?.username));
          setIsLoading(false);
        }
      }
    };
    void loadUser();
  }, [remoteUser, loaded]);

  const setUsername = useCallback(async (newUsername: string | null) => {
    setUsernameState(newUsername);
    try {
      if (newUsername) {
        await AsyncStorage.multiRemove([SIGNED_OUT_KEY]);
        await AsyncStorage.setItem(USERNAME_KEY, newUsername);
      } else {
        await AsyncStorage.removeItem(USERNAME_KEY);
      }
    } catch {
      // Persisting the username is best-effort; the context already updated.
    }
  }, []);

  const logout = useCallback(async () => {
    // Mark first so no concurrent render can re-sync the username from the
    // server while the local data is being cleared.
    try {
      await AsyncStorage.setItem(SIGNED_OUT_KEY, 'true');
    } catch {
      // Continue signing out even if storage is unavailable.
    }
    try {
      await CacheManager.clear();
    } catch {
      // Cache clearing is best-effort.
    }
    await setUsername(null);
    setIsLoading(false);
    try {
      router.replace('/onboarding');
    } catch {
      // Navigation may not be ready in tests/edge cases.
    }
  }, [setUsername]);

  return (
    <UserContext.Provider value={{ username, setUsername, isLoading, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
