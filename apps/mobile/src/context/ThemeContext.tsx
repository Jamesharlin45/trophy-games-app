import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accentTokens, dark, light, type AccentType, type ThemeColors } from '../theme/colors';

export type ThemeType = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: ThemeType;
    accent: AccentType;
    isDark: boolean;
    themeColors: ThemeColors;
    toggleTheme: () => void;
    setTheme: (theme: ThemeType) => void;
    setAccent: (accent: AccentType) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const VALID_THEMES: readonly ThemeType[] = ['light', 'dark', 'system'];
const VALID_ACCENTS: readonly AccentType[] = ['pitchGreen', 'gold', 'oceanBlue', 'royalPurple'];

/** Only persist strings we recognise; storage failures never reach the UI. */
async function persist(key: string, value: string): Promise<void> {
    try {
        await AsyncStorage.setItem(key, value);
    } catch {
        // Preferences are best-effort; the in-memory choice still applies.
    }
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const systemColorScheme = useColorScheme();
    // Defaults keep today's look: Dark mode + Pitch Green.
    const [theme, setThemeState] = useState<ThemeType>('dark');
    const [accent, setAccentState] = useState<AccentType>('pitchGreen');

    useEffect(() => {
        // Apply a saved theme on start — children render immediately with the
        // system scheme so there is no flicker while it loads.
        const loadTheme = async () => {
            try {
                const savedTheme = await AsyncStorage.getItem('user-theme');
                if (typeof savedTheme === 'string' && VALID_THEMES.includes(savedTheme as ThemeType)) {
                    setThemeState(savedTheme as ThemeType);
                }
                const savedAccent = await AsyncStorage.getItem('user-accent');
                if (typeof savedAccent === 'string' && VALID_ACCENTS.includes(savedAccent as AccentType)) {
                    setAccentState(savedAccent as AccentType);
                }
            } catch (e) {
                // Corrupted or unavailable storage → keep the defaults.
                console.warn('Unable to load theme preferences:', e);
            }
        };
        void loadTheme();
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setThemeState(newTheme);
        void persist('user-theme', newTheme);
    };

    const setTheme = (newTheme: ThemeType) => {
        if (!VALID_THEMES.includes(newTheme)) return;
        setThemeState(newTheme);
        void persist('user-theme', newTheme);
    };

    const setAccent = (newAccent: AccentType) => {
        if (!VALID_ACCENTS.includes(newAccent)) return;
        setAccentState(newAccent);
        void persist('user-accent', newAccent);
    };

    const isDark = theme === 'system' ? systemColorScheme === 'dark' : theme === 'dark';
    // Never index a missing/renamed accent token: fall back to the default.
    const selected = accentTokens[accent] ?? accentTokens.pitchGreen;
    const base = isDark ? dark : light;
    const themeColors: ThemeColors = {
        ...base,
        accent: selected.accent,
        onAccent: selected.onAccent,
        accentText: selected.onAccent,
        surfaceAlt: base.surfaceAlt,
        textSecondary: base.textSecondary,
        onSurface: base.onSurface,
    };

    return (
        <ThemeContext.Provider value={{ theme, accent, isDark, themeColors, toggleTheme, setTheme, setAccent }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
