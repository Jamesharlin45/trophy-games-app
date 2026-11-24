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

        const stored = await AsyncStorage.getItem(USERNAME_KEY);
        if (stored) {
          setUsernameState(stored);
        } else if (loaded) {
          // Fallback: if the account exists on the server but not in local
          // storage, sync it back down (unless the user just signed out).
          if (remoteUser?.username) {
            await AsyncStorage.setItem(USERNAME_KEY, remoteUser.username);
            setUsernameState(remoteUser.username);
          } else {
            setUsernameState(null);
          }
        }
      } catch (e) {
        console.error('Failed to load username', e);
      } finally {
        if (loaded) {
          setIsLoading(false);
        }
      }
    };
    void loadUser();
  }, [remoteUser, loaded]);

  const setUsername = useCallback(async (newUsername: string | null) => {
    setUsernameState(newUsername);
    if (newUsername) {
      await AsyncStorage.multiRemove([SIGNED_OUT_KEY]);
      await AsyncStorage.setItem(USERNAME_KEY, newUsername);
    } else {
      await AsyncStorage.removeItem(USERNAME_KEY);
    }
  }, []);

  const logout = useCallback(async () => {
    // Mark first so no concurrent render can re-sync the username from the
    // server while the local data is being cleared.
    await AsyncStorage.setItem(SIGNED_OUT_KEY, 'true');
    await CacheManager.clear();
    await setUsername(null);
    setIsLoading(false);
    router.replace('/onboarding');
  }, []);

  return (
    <UserContext.Provider value={{ username, setUsername, isLoading, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
