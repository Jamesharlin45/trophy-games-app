// Central theme file — every colour used by the mobile app lives here.
// Tokens: background, surface, text, mutedText, border, accent, accentText,
// success, warning, danger (+ supporting tokens: surfaceElevated, glass,
// shadow, gray5, orange9, blue10).

export interface ThemeColors {
    /** Screen background colour. */
    background: string;
    /** Primary card / surface colour. */
    surface: string;
    /** Elevated surfaces (secondary cards, panels). */
    surfaceElevated: string;
    /** Primary text colour. */
    text: string;
    /** Muted text, icons and labels. */
    mutedText: string;
    /** Borders and dividers. */
    border: string;
    /** Accent (brand) colour — varies with the accent theme. */
    accent: string;
    /** Text colour on accent-filled elements. */
    accentText: string;
    success: string;
    warning: string;
    danger: string;
    /** Faint tint used for chips and subtle boxes. */
    glass: string;
    /** Neutral shadow colour. */
    shadow: string;
    gray5: string;
    orange9: string;
    blue10: string;
}

export interface AccentTokens {
    /** Brand colour used for primary buttons, the active tab, the selected
     * date chip, pills and highlights. */
    accent: string;
    /** Text colour on accent-filled elements. */
    accentText: string;
    /** Display name, e.g. for accessibility labels on the Settings accent dots. */
    label: string;
}

/** Accent themes on top of the mode. Pitch Green is the default. */
export const accents = {
    pitchGreen: { accent: '#00C805', accentText: '#090A0C', label: 'Pitch Green' },
    gold: { accent: '#F59E0B', accentText: '#0B0E12', label: 'Gold' },
    oceanBlue: { accent: '#3B82F6', accentText: '#FFFFFF', label: 'Ocean Blue' },
    royalPurple: { accent: '#8B5CF6', accentText: '#FFFFFF', label: 'Royal Purple' },
} as const;

export type AccentType = keyof typeof accents;

export const dark: ThemeColors = {
    background: '#090A0C', // Deep stealth dark blue-gray
    surface: '#121418', // Slightly elevated card
    surfaceElevated: '#1A1D24', // More elevated elements
    accent: '#00C805', // Vibrant RobinHood green (Pitch Green, the default)
    accentText: '#090A0C',
    text: '#FFFFFF',
    mutedText: '#8B949E',
    border: 'rgba(255,255,255,0.06)',
    success: '#00C805',
    warning: '#EAB308',
    danger: '#EF4444',
    glass: 'rgba(255, 255, 255, 0.04)',
    shadow: '#000000',
    gray5: '#21262D',
    orange9: '#F97316',
    blue10: '#60A5FA',
};

export const light: ThemeColors = {
    background: '#F4F6F8',
    surface: '#FFFFFF',
    surfaceElevated: '#F1F5F9',
    accent: '#00C805', // overridden by the selected accent theme
    accentText: '#090A0C',
    text: '#111827',
    mutedText: '#64748B',
    border: 'rgba(0,0,0,0.07)',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#EF4444',
    glass: 'rgba(0, 0, 0, 0.04)',
    shadow: '#000000',
    gray5: '#D1D5DB',
    orange9: '#F97316',
    blue10: '#3B82F6',
};
