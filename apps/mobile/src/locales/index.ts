import { I18n } from 'i18n-js';
import en from './en';
import fr from './fr';
import es from './es';

const translations = {
    en,
    fr,
    es,
};

const i18n = new I18n(translations);

i18n.enableFallback = true;
i18n.defaultLocale = 'en';

export default i18n;

/**
 * Type-safe array access for the locale arrays (languages, feature lists).
 * i18n-js types `t()` as returning a string, so cast the runtime array.
 */
export function tArray<T = string>(key: string): T[] {
    const value = i18n.t(key);
    return (Array.isArray(value) ? value : []) as T[];
}
