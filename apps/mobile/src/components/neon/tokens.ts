/**
 * Shared neon tokens.
 *
 * Every colour comes from the theme/accent tokens — this file only converts
 * those tokens into alpha variants and shadow presets. Light mode keeps the
 * accent border but reduces the glow so it never washes out text.
 */

import { dark, type ThemeColors } from '../../theme/colors';

export const NEON_RADIUS = 18;
export const NEON_RADIUS_LARGE = 20;

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

function rgbFrom(color: string): [number, number, number] | null {
    const value = color.trim();
    if (!value.startsWith('#')) return null;
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (![r, g, b].every(Number.isFinite)) return null;
    return [r, g, b];
}

/**
 * Accent colour to use for text/icons. Dark mode keeps the pure accent;
 * light mode mixes it halfway into the theme text token so it stays readable
 * on light surfaces (≥4.5:1) while still reading as the selected accent.
 */
export function readableOnSurface(color: string, themeColors: ThemeColors, isDark: boolean): string {
    if (isDark) return color;
    const value = rgbFrom(color);
    const ink = rgbFrom(themeColors.text);
    if (!value || !ink) return color;
    const mixed = value.map((channel, i) => Math.round((channel + ink[i]) / 2));
    return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

export function readableAccent(themeColors: ThemeColors, isDark: boolean): string {
    return readableOnSurface(themeColors.accent, themeColors, isDark);
}

function relativeLuminance(color: string): number {
    const rgb = withAlpha(color, 1);
    const match = /^rgba\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
    if (!match) return 0;
    const channel = (raw: string): number => {
        const c = Number(raw) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(match[1]) + 0.7152 * channel(match[2]) + 0.0722 * channel(match[3]);
}

/**
 * Readable text token for a non-accent filled surface (for example the
 * orange Premium CTA). Accent fills use `themeColors.accentText` directly so
 * the selected accent's onAccent token is always respected.
 */
export function onColor(color: string): string {
    const bg = relativeLuminance(color);
    const contrast = (fg: string): number => {
        const l = relativeLuminance(fg);
        return (Math.max(bg, l) + 0.05) / (Math.min(bg, l) + 0.05);
    };
    return contrast(dark.accentText) >= contrast(dark.text) ? dark.accentText : dark.text;
}

/** 1px accent border at 35–50% opacity. */
export function neonBorder(accent: string, strong = false): string {
    return withAlpha(accent, strong ? 0.5 : 0.42);
}

/** Soft accent glow. Android gets `elevation` plus the same shadow colour. */
export function neonShadow(
    accent: string,
    isDark: boolean,
    strong = false,
): {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
} {
    return {
        shadowColor: accent,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: isDark ? (strong ? 0.5 : 0.38) : strong ? 0.26 : 0.18,
        shadowRadius: isDark ? (strong ? 14 : 12) : strong ? 11 : 10,
        elevation: isDark ? (strong ? 6 : 4) : strong ? 2 : 1,
    };
}

/** Neutral token helper for dividers and quiet fillers. */
export function dividerColor(themeColors: ThemeColors): string {
    return themeColors.border;
}
