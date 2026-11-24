import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { api } from '../api/client';
import { useApiQuery } from '../hooks/useLiveQuery';
import { getDeviceId } from '../utils/deviceId';
import { CacheManager } from '../utils/cache';

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
        const stored = await AsyncStorage.getItem('@trophy_games_username');
        if (stored) {
          setUsernameState(stored);
        } else if (loaded) {
            // Fallback: If the account exists on the server but not in local
            // storage, sync it back down.
            if (remoteUser?.username) {
                await AsyncStorage.setItem('@trophy_games_username', remoteUser.username);
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

  const setUsername = async (newUsername: string | null) => {
    setUsernameState(newUsername);
    if (newUsername) {
      await AsyncStorage.setItem('@trophy_games_username', newUsername);
    } else {
      await AsyncStorage.removeItem('@trophy_games_username');
    }
  };

  const logout = async () => {
    await setUsername(null);
    // Clear cached data (user, match/membership caches) so nothing stale is
    // served after signing back in. The theme choice is intentionally kept.
    await CacheManager.clear();
    router.replace('/onboarding');
  };

  return (
    <UserContext.Provider value={{ username, setUsername, isLoading, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
