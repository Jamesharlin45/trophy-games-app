import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from '../locales';

type LanguageContextType = {
    locale: string;
    setLocale: (locale: string) => Promise<void>;
};

const LanguageContext = createContext<LanguageContextType>({
    locale: 'en',
    setLocale: async () => {},
});

/** Locales bundled in src/locales. Anything else falls back to English. */
const SUPPORTED_LOCALES = ['en', 'fr', 'es'] as const;

function isSupportedLocale(value: unknown): value is string {
    return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function applyLocale(locale: string): string {
    try {
        i18n.locale = locale;
        return locale;
    } catch {
        // A broken locale value must never take the app down.
        try {
            i18n.locale = 'en';
        } catch {
            // Ignore — the default translations are already loaded.
        }
        return 'en';
    }
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState(i18n.locale);

    useEffect(() => {
        const loadLang = async () => {
            try {
                const saved = await AsyncStorage.getItem('user-language');
                if (isSupportedLocale(saved)) {
                    setLocaleState(applyLocale(saved));
                    return;
                }

                // Missing or corrupted value: follow the device language when
                // it is one we ship, otherwise English.
                const deviceLocales = getLocales();
                const deviceLang = Array.isArray(deviceLocales)
                    ? deviceLocales[0]?.languageCode
                    : undefined;
                setLocaleState(applyLocale(isSupportedLocale(deviceLang) ? deviceLang : 'en'));
            } catch (e) {
                // expo-localization/storage unavailable → keep English.
                console.warn('Unable to load language preference:', e);
                setLocaleState(applyLocale('en'));
            }
        };
        void loadLang();
    }, []);

    const setLocale = async (newLocale: string) => {
        if (!isSupportedLocale(newLocale)) return;
        setLocaleState(applyLocale(newLocale));
        try {
            await AsyncStorage.setItem('user-language', newLocale);
        } catch {
            // The in-memory locale still applies for this session.
        }
    };

    return (
        <LanguageContext.Provider value={{ locale, setLocale }}>
            {children}
        </LanguageContext.Provider>
    );
}

export const useLanguage = () => useContext(LanguageContext);
