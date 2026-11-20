import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accents, dark, light, type AccentType, type ThemeColors } from '../theme/colors';

type ThemeType = 'light' | 'dark' | 'system';

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

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const systemColorScheme = useColorScheme();
    // Defaults keep today's look: Dark mode + Pitch Green.
    const [theme, setThemeState] = useState<ThemeType>('dark');
    const [accent, setAccentState] = useState<AccentType>('pitchGreen');
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const loadTheme = async () => {
            try {
                const savedTheme = await AsyncStorage.getItem('user-theme');
                if (savedTheme && VALID_THEMES.includes(savedTheme as ThemeType)) {
                    setThemeState(savedTheme as ThemeType);
                }
                const savedAccent = await AsyncStorage.getItem('user-accent');
                if (savedAccent && VALID_ACCENTS.includes(savedAccent as AccentType)) {
                    setAccentState(savedAccent as AccentType);
                }
            } catch (e) {
                console.warn(e);
            } finally {
                setIsLoaded(true);
            }
        };
        loadTheme();
    }, []);

    const toggleTheme = async () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setThemeState(newTheme);
        await AsyncStorage.setItem('user-theme', newTheme);
    };

    const setTheme = async (newTheme: ThemeType) => {
        setThemeState(newTheme);
        await AsyncStorage.setItem('user-theme', newTheme);
    };

    const setAccent = async (newAccent: AccentType) => {
        setAccentState(newAccent);
        await AsyncStorage.setItem('user-accent', newAccent);
    };

    const isDark = theme === 'system' ? systemColorScheme === 'dark' : theme === 'dark';
    const accentTokens = accents[accent];
    const themeColors: ThemeColors = {
        ...(isDark ? dark : light),
        accent: accentTokens.accent,
        accentText: accentTokens.accentText,
    };

    if (!isLoaded) return null;

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
