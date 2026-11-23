// Central theme file — every colour used by the mobile app lives here.
// Tokens: background, surface, surfaceAlt, border, text, textSecondary,
// accent, onAccent (computed from accent luminance), success, warning,
// danger, glass, shadow. All elevated surfaces are OPAQUE; Light mode has
// no glow. The green accent is a vivid neon lime in Dark mode.

export interface ThemeColors {
    /** Screen background colour (`bg` token). */
    background: string;
    /** Alias of `background`. */
    bg: string;
    /** Primary card / surface colour. */
    surface: string;
    /** Elevated surfaces (secondary cards, panels). */
    surfaceAlt: string;
    /** Older alias of surfaceAlt, kept for callers that have not migrated. */
    surfaceElevated: string;
    /** Primary text colour. */
    text: string;
    /** Secondary text colour (muted labels, captions). */
    textSecondary: string;
    /** Muted text, icons and labels (legacy alias). */
    mutedText: string;
    /** 1px borders and dividers. */
    border: string;
    /** Accent (brand) colour — varies with the accent theme. */
    accent: string;
    /** Text colour on accent-filled elements. */
    onAccent: string;
    /** Legacy alias of onAccent. */
    accentText: string;
    success: string;
    warning: string;
    danger: string;
    /** Faint fill used for quiet surfaces (chips, subtle boxes). Opaque. */
    glass: string;
    /** Neutral shadow colour (soft drop shadows). */
    shadow: string;
    gray5: string;
    orange9: string;
    blue10: string;
    /** Text colour on opaque surfaces (equal to `text` by design). */
    onSurface: string;
}

export interface AccentTokens {
    /** Brand colour used for primary buttons, the active tab, the selected
     * date chip, pills and highlights. */
    accent: string;
    /** Text colour on accent-filled elements — computed for readability. */
    onAccent: string;
    /** Display name, e.g. for accessibility labels on the Settings accent dots. */
    label: string;
}

export interface ThemeBase {
    /** Screen background colour. */
    background: string;
    /** Primary card / surface colour. */
    surface: string;
    /** Elevated surfaces. */
    surfaceAlt: string;
    /** 1px borders and dividers. */
    border: string;
    /** Primary text colour. */
    text: string;
    /** Secondary text colour. */
    textSecondary: string;
    success: string;
    warning: string;
    danger: string;
    /** Faint neutral fill (chips, subtle boxes). */
    glass: string;
    /** Neutral shadow colour. */
    shadow: string;
    gray5: string;
    orange9: string;
    blue10: string;
}

// ---------------------------------------------------------------------------
// Luminance / contrast helpers (for the computed onAccent token)
// ---------------------------------------------------------------------------

export function relativeLuminance(color: string): number {
    const value = color.trim();
    let hex = value.startsWith('#') ? value.slice(1) : value;
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return 0;
    const channel = (raw: string): number => {
        const c = parseInt(raw, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(hex.slice(0, 2)) + 0.7152 * channel(hex.slice(2, 4)) + 0.0722 * channel(hex.slice(4, 6));
}

function contrastRatio(fg: string, bg: string): number {
    const a = relativeLuminance(fg);
    const b = relativeLuminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Text colour for an accent fill: the option with the higher WCAG contrast
 * ratio. Always readable — e.g. the neon lime in Dark gets a near-black
 * onAccent, while sky blue and violet get the light text.
 */
export function onAccentFor(accent: string): string {
    const white = contrastRatio('#FFFFFF', accent);
    const black = contrastRatio('#000000', accent);
    return white >= black ? '#FFFFFF' : '#090A0C';
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/** Accent themes on top of the mode. Pitch Green is the default. */
export const accents = {
    pitchGreen: { accent: '#7CFF00', label: 'Pitch Green' },
    gold: { accent: '#F59E0B', label: 'Gold' },
    oceanBlue: { accent: '#3B82F6', label: 'Ocean Blue' },
    royalPurple: { accent: '#8B5CF6', label: 'Royal Purple' },
} as const;

export type AccentType = keyof typeof accents;

export const accentTokens: Record<AccentType, AccentTokens> = {
    pitchGreen: { accent: '#7CFF00', onAccent: onAccentFor('#7CFF00'), label: 'Pitch Green' },
    gold: { accent: '#F59E0B', onAccent: onAccentFor('#F59E0B'), label: 'Gold' },
    oceanBlue: { accent: '#3B82F6', onAccent: onAccentFor('#3B82F6'), label: 'Ocean Blue' },
    royalPurple: { accent: '#8B5CF6', onAccent: onAccentFor('#8B5CF6'), label: 'Royal Purple' },
};

export const darkBase: ThemeBase = {
    background: '#0A0C0F', // Near-black
    surface: '#14181D', // Cards
    surfaceAlt: '#1B2027', // Elevated panels
    border: 'rgba(255,255,255,0.10)', // 1px borders
    text: '#FFFFFF',
    textSecondary: '#9CA3AF',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
    glass: '#1E2128', // Subtle neutral fill
    shadow: '#000000',
    gray5: '#242830',
    orange9: '#F97316',
    blue10: '#3B82F6',
};

export const lightBase: ThemeBase = {
    background: '#F2F4F7', // Light grey background
    surface: '#FFFFFF', // White surfaces
    surfaceAlt: '#F8FAFC', // Elevated (opaque)
    border: 'rgba(0,0,0,0.08)', // 1px borders — very soft, no glow
    text: '#111827',
    textSecondary: '#64748B',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#EF4444',
    glass: '#F1F5F9', // Subtle neutral fill
    shadow: '#000000',
    gray5: '#E5E7EB',
    orange9: '#F97316',
    blue10: '#3B82F6',
};

export const dark: ThemeColors = {
    ...darkBase,
    surfaceElevated: darkBase.surfaceAlt,
    bg: darkBase.background,
    accent: '#00C805', // fallback — replaced by the selected accent theme
    onAccent: '#090A0C',
    accentText: '#090A0C',
    onSurface: '#FFFFFF',
    mutedText: '#8B949E',
};

export const light: ThemeColors = {
    ...lightBase,
    surfaceElevated: lightBase.surfaceAlt,
    bg: lightBase.background,
    accent: '#00C805',
    onAccent: '#090A0C',
    accentText: '#090A0C',
    onSurface: '#111827',
    mutedText: '#64748B',
};
