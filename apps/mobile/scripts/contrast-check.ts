/**
 * Contrast checker (Bug 2, #4 of the audit): verifies the readability of every
 * text/background token pair used by the shared components in all 8 theme
 * combinations (Light/Dark x Pitch Green/Gold/Ocean Blue/Royal Purple).
 *
 * Fails below 4.5:1 for normal text (and 3:1 for large text — fontSize ≥ 18,
 * used sparingly for the few largest labels). Run with bun:
 *
 *   bun scripts/contrast-check.ts
 *
 * Exit code is non-zero when any pair falls below its threshold.
 */

import { relativeLuminance, accentTokens, dark, light, type ThemeColors, type AccentType } from '../src/theme/colors';
import { onColor } from '../src/components/neon/tokens';
import type { PillTone } from '../src/components/design/Pill';
import type { BadgeKind } from '../src/components/design/Badge';

const MODES: Array<{ mode: 'light' | 'dark'; accent: AccentType }> = [];
for (const mode of ['light', 'dark'] as const) {
    for (const accent of Object.keys(accentTokens) as AccentType[]) {
        MODES.push({ mode, accent });
    }
}

function themeColors(mode: 'light' | 'dark', accent: AccentType): ThemeColors {
    const base = mode === 'dark' ? dark : light;
    const selected = accentTokens[accent];
    return {
        ...base,
        accent: selected.accent,
        onAccent: selected.onAccent,
        accentText: selected.onAccent,
    };
}

function contrastRatio(fg: string, bg: string): number {
    const a = relativeLuminance(fg);
    const b = relativeLuminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

interface PairRecord {
    component: string;
    text: string;
    bg: string;
    ratio: number;
    threshold: number;
    ok: boolean;
}

const failures: PairRecord[] = [];
const records: PairRecord[] = [];

function check(component: string, text: string, bg: string, isLarge = false): number {
    const ratio = contrastRatio(text, bg);
    const threshold = isLarge ? 3 : 4.5;
    const ok = ratio + 0.01 >= threshold;
    records.push({ component, text, bg, ratio, threshold, ok });
    if (!ok) failures.push(records[records.length - 1]);
    return ratio;
}

/** Pill tone → fill colour (mirrors Pill.tsx toneColor). */
function pillFill(tone: PillTone, tc: ThemeColors): string {
    switch (tone) {
        case 'info': return tc.blue10;
        case 'success': return tc.success;
        case 'warning': return tc.warning;
        case 'danger': return tc.danger;
        case 'neutral': return tc.textSecondary;
        case 'accent':
        default: return tc.accent;
    }
}

/** Badge fill + text (mirrors Badge.tsx badgeStyle, post-fix). */
function badgeStyle(kind: BadgeKind, tc: ThemeColors): { color: string; textColor: string } {
    switch (kind) {
        case 'win': return { color: tc.success, textColor: onColor(tc.success) };
        case 'lose': return { color: tc.danger, textColor: onColor(tc.danger) };
        case 'void': return { color: tc.textSecondary, textColor: onColor(tc.textSecondary) };
        case 'pending': return { color: tc.warning, textColor: onColor(tc.warning) };
        case 'free':
        case 'vip':
        case 'paid': return { color: tc.accent, textColor: tc.onAccent };
    }
}

function run() {
    for (const { mode, accent } of MODES) {
        const tc = themeColors(mode, accent);
        const tag = `${mode}/${accent}`;

        // Pill — filled (accent fill → onAccent) and outline (glass → readable ink).
        const tones: PillTone[] = ['accent', 'info', 'success', 'warning', 'danger', 'neutral'];
        for (const tone of tones) {
            const fill = pillFill(tone, tc);
            const filledText = tone === 'accent' ? tc.onAccent : onColor(fill);
            check(`Pill filled (${tone}) [${tag}]`, filledText, fill);
            // Outline/transparent pill: readable ink on glass.
            check(`Pill outline (${tone}) [${tag}]`, onColor(tc.glass), tc.glass);
        }

        // Badge — every kind, on their own opaque fills.
        const kinds: BadgeKind[] = ['win', 'lose', 'void', 'pending', 'free', 'vip', 'paid'];
        for (const kind of kinds) {
            const { color, textColor } = badgeStyle(kind, tc);
            check(`Badge (${kind}) [${tag}]`, textColor, color);
        }

        // MatchRow — scores and live status (on the opaque surface).
        check(`MatchRow scores [${tag}]`, tc.onSurface, tc.surface);
        check(`MatchRow live status [${tag}]`, tc.onSurface, tc.surface);
        check(`MatchRow timeCol status [${tag}]`, tc.text, tc.surface);

        // LeagueHeader — count pill: the Pill renders with a glass fill and
        // readable ink on it (the header itself is surfaceAlt).
        check(`LeagueHeader count pill [${tag}]`, onColor(tc.glass), tc.glass);
        check(`LeagueHeader header text [${tag}]`, tc.onSurface, tc.surfaceAlt);

        // AppButton — all variants.
        check(`AppButton primary [${tag}]`, tc.onAccent, tc.accent);
        check(`AppButton outline [${tag}]`, tc.onAccent, tc.accent);
        check(`AppButton ghost [${tag}]`, onColor(tc.glass), tc.glass);
        check(`AppButton danger [${tag}]`, onColor(tc.danger), tc.danger);

        // ProgressBar — visible percentage label (small text).
        check(`ProgressBar label [${tag}]`, tc.text, tc.surfaceAlt);

        // AppTabs — active tab label readable on the bar surface.
        check(`AppTabs active label [${tag}]`, tc.onSurface, tc.surface);
    }

    // ---- Report ----
    const worst = records.reduce((a, r) => (r.ratio < a.ratio ? r : a), records[0]);
    console.table(records.map(({ component, text, bg, ratio, threshold, ok }) => ({
        component, text, bg,
        'ratio': Number(ratio.toFixed(2)),
        'min': threshold,
        ok: ok ? 'pass' : 'FAIL',
    })));
    if (failures.length > 0) {
        console.error(`\n${failures.length} contrast FAILURE(S), e.g. worst: ${worst.component} (${worst.ratio.toFixed(2)}:1 < ${worst.threshold}:1) — text "${worst.text}" on bg "${worst.bg}"`);
        process.exit(1);
    }
    console.log(`\nAll ${records.length} pairs pass (worst ratio: ${worst.ratio.toFixed(2)}:1 on ${worst.component}).`);
}

run();
