/**
 * Colour helpers for team crests, gradients and readable header text.
 *
 * The team-colour service returns { hex } strings. These helpers parse them,
 * decide when a colour is safe to use (missing, near-white, near-black, grey)
 * and when text on a colour would be unreadable, plus a small HSL adjust.
 */

export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface Hsl {
    h: number;
    s: number;
    l: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function parseHex(hex: string | undefined): Rgba | null {
    if (!hex) return null;
    const match = HEX_RE.exec(hex.trim());
    if (!match) return null;
    let digits = match[1].toLowerCase();
    if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('');
    const value = parseInt(digits, 16);
    const r = (value >> 16) & 0xff;
    const g = (value >> 8) & 0xff;
    const b = value & 0xff;
    const a = digits.length === 8 ? ((value >> 24) & 0xff) / 255 : 1;
    return { r, g, b, a };
}

export function toHex(c: Rgba): string {
    const h = (n: number) => n.toString(16).padStart(2, '0');
    return `#${h(Math.round(c.r))}${h(Math.round(c.g))}${h(Math.round(c.b))}`;
}

export function luminance(c: Rgba): number {
    // Rec. 709 relative luminance, 0..1.
    return 0.2126 * (c.r / 255) + 0.7152 * (c.g / 255) + 0.0722 * (c.b / 255);
}

export function saturation(c: Rgba): number {
    const mx = Math.max(c.r, c.g, c.b);
    const mn = Math.min(c.r, c.g, c.b);
    return mx === 0 ? 0 : (mx - mn) / mx;
}

export function rgbToHsl(c: Rgba): Hsl {
    const r = c.r / 255;
    const g = c.g / 255;
    const b = c.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) {
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    } else if (max === g) {
        h = ((b - r) / d + 2) / 6;
    } else {
        h = ((r - g) / d + 4) / 6;
    }
    return { h, s: Number.isFinite(s) ? s : 0, l };
}

export function hslToRgb(hsl: Hsl): Rgba {
    const c = (1 - Math.abs(2 * hsl.l - 1)) * hsl.s;
    const hp = hsl.h * 6;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hp < 1) [r1, g1, b1] = [c, x, 0];
    else if (hp < 2) [r1, g1, b1] = [x, c, 0];
    else if (hp < 3) [r1, g1, b1] = [0, c, x];
    else if (hp < 4) [r1, g1, b1] = [0, x, c];
    else if (hp < 5) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const m = hsl.l - c / 2;
    return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255), a: 1 };
}

function setLuma(hex: string | undefined, target: number): string | undefined {
    const c = parseHex(hex);
    if (!c) return undefined;
    const hsl = rgbToHsl(c);
    hsl.l = Math.min(0.97, Math.max(0.02, target));
    return toHex(hslToRgb(hsl));
}

/**
 * Team colour for the overview header background. Falls back to the accent
 * when the colour is missing, grey, near-white or near-black. Very dark
 * colours are lifted (text reads better); very bright ones are dimmed.
 */
export function headerBgColor(hex: string | undefined, accent: string): string {
    const c = parseHex(hex);
    if (!c || saturation(c) < 0.08) return accent;
    const l = luminance(c);
    if (l > 0.92 || l < 0.12) return accent;
    if (l < 0.30) return setLuma(hex, 0.45) ?? accent;
    if (l > 0.70) return setLuma(hex, 0.58) ?? accent;
    return toHex(c);
}

/** Text colour that reads against the header background. */
export function headerTextColor(headerBg: string, accentText: string, text: string): string {
    const c = parseHex(headerBg);
    if (!c) return accentText;
    const l = luminance(c);
    if (l > 0.62) return setLuma(headerBg, 0.25) ?? text;
    if (l < 0.38) return setLuma(headerBg, 0.72) ?? accentText;
    return headerBg;
}

/**
 * Returns a colour that reads well on dark backgrounds:
 * - undefined when the colour is missing, grey (near-monochrome), or the
 *   shade that the caller already handles (see isBgUsable).
 */
export function usableCopy(hex: string | undefined): string | undefined {
    const c = parseHex(hex);
    if (!c) return undefined;
    if (saturation(c) < 0.08) return undefined; // grey
    return toHex(c);
}

/** True when the colour is missing, near white, near black or grey. */
export function isBgUsable(hex: string | undefined): boolean {
    const c = parseHex(hex);
    if (!c) return false;
    if (saturation(c) < 0.08) return false; // grey
    const l = luminance(c);
    if (l > 0.94 || l < 0.08) return false; // near white / near black
    return true;
}

/**
 * Tones down a team colour so it reads as text/gradient on a dark navy
 * screen: very light colours are desaturated and pulled toward mid-dark,
 * very dark ones are lifted a touch.
 */
export function readableCopy(hex: string | undefined): string | undefined {
    const c = parseHex(hex);
    if (!c) return undefined;
    if (saturation(c) < 0.08) return undefined; // grey
    const hsl = rgbToHsl(c);
    if (hsl.l > 0.86) {
        hsl.s = Math.max(0.18, hsl.s * 0.7);
        hsl.l = Math.max(0.2, Math.min(0.6, hsl.l - 0.22));
    } else if (hsl.l < 0.15) {
        hsl.l = Math.min(0.9, hsl.l + 0.08);
    }
    return toHex(hslToRgb(hsl));
}

/** Format an ARGB-ordered integer-ish value; kept for API parity. */
export function formatHex(value: number): string {
    return `#${(value >>> 24).toString(16).padStart(2, '0')}${((value >> 16) & 0xff).toString(16).padStart(2, '0')}${((value >> 8) & 0xff).toString(16).padStart(2, '0')}${(value & 0xff).toString(16).padStart(2, '0')}`;
}
