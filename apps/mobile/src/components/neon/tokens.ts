/**
 * Shared neon tokens.
 *
 * Every colour comes from the theme tokens — this file converts them into
 * shadow presets and readable-ink helpers. Dark mode carries the accent
 * border + soft glow; Light mode has no glow at all.
 */

import { dark, type ThemeColors } from '../../theme/colors';

export const NEON_RADIUS = 18;
export const NEON_RADIUS_LARGE = 20;

export interface NeonShadowPreset {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
}

/**
 * Neutral 1px border token — same in both modes. Used for card, pill and
 * divider borders so they survive every theme.
 */
export function neonBorder(_themeColors: ThemeColors): string {
    return _themeColors.border;
}

/**
 * Soft accent shadow: Dark gets the glow (accent shadow, opacity 0.38–0.5,
 * radius 12–14, elevation 4–6); Light gets none (opacity 0, elevation 0).
 */
export function neonShadow(themeColors: ThemeColors, isDark: boolean, strong = false): NeonShadowPreset {
    return {
        shadowColor: isDark ? themeColors.accent : themeColors.text,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: isDark ? (strong ? 0.5 : 0.4) : 0,
        shadowRadius: isDark ? (strong ? 14 : 12) : 0,
        elevation: isDark ? (strong ? 6 : 4) : 0,
    };
}

/** Accent border at 35–50% opacity (Dark); the theme border in Light. */
export function neonAccentBorder(themeColors: ThemeColors, isDark: boolean, strong = false): string {
    if (isDark) {
        return withAlpha(themeColors.accent, strong ? 0.5 : 0.42);
    }
    return themeColors.accent;
}

/** Convert a theme token (#rgb, #rrggbb, #rrggbbaa or rgba()) to rgba with `alpha`. */
export function withAlpha(color: string, alpha: number): string {
    const a = Math.min(1, Math.max(0, alpha));
    const value = color.trim();

    if (value.startsWith('#')) {
        let hex = value.slice(1);
        if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            if ([r, g, b].every(Number.isFinite)) return `rgba(${r}, ${g}, ${b}, ${a})`;
        }
    }

    const rgba = /^rgba?\(([^)]+)\)$/i.exec(value);
    if (rgba) {
        const parts = rgba[1].split(',').map((part) => part.trim());
        if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
    }

    // Theme tokens are always one of the formats above; keep the input as a
    // safe fallback rather than inventing a colour.
    return value;
}

/** Text colour on accent-filled elements — always readable (onAccent token). */
export function readableAccent(themeColors: ThemeColors): string {
    return themeColors.onAccent;
}

/** Text colour on opaque surfaces — always the theme text token. */
export function readableOnSurface(themeColors: ThemeColors): string {
    return themeColors.onSurface;
}

/**
 * Text colour on an arbitrary opaque fill: picks the higher-contrast option
 * between white and the theme's dark text.
 */
export function onColor(color: string): string {
    const bg = relativeLuminance(color);
    const contrast = (fg: string): number => {
        const l = relativeLuminance(fg);
        return (Math.max(bg, l) + 0.05) / (Math.min(bg, l) + 0.05);
    };
    return contrast(dark.text) >= contrast('#000000') ? dark.text : '#000000';
}

function relativeLuminance(color: string): number {
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

/** Neutral token helper for dividers and quiet fillers. */
export function dividerColor(themeColors: ThemeColors): string {
    return themeColors.border;
}

/** Soft drop-shadow preset for headline cards (Dark mode only, Light none). */
export function headlineShadow(themeColors: ThemeColors): NeonShadowPreset {
    const isDark = themeColors.onAccent === '#090A0C' || relativeLuminance(themeColors.background) > 0.5;
    return {
        shadowColor: themeColors.accent,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: isDark ? 0.35 : 0,
        shadowRadius: isDark ? 12 : 0,
        elevation: isDark ? 4 : 0,
    };
}
