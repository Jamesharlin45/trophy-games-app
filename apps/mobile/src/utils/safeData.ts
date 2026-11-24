/**
 * Safe accessors for data that arrives from the web API or navigation
 * params. Fields can be missing or malformed (old caches, partial
 * responses, hand-edited documents), so screens use these helpers to
 * render with safe defaults instead of crashing on a bad row.
 */

/** Returns the string value, or a safe fallback when missing or non-string. */
export function safeString(value: unknown, fallback = ''): string {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Coerces unknown data to a number; NaN/null/non-finite → fallback. */
export function safeNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A validated Date instance or null. */
export function toValidDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value !== 'string' || value.length === 0) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Locale time like "10:30 AM"; empty string when the value is not a valid date. */
export function safeTime(value: unknown): string {
    const date = toValidDate(value);
    if (!date) return '';
    try {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

/** Full locale date+time; safe fallback when the value is not a valid date. */
export function safeDateTime(value: unknown, fallback = ''): string {
    const date = toValidDate(value);
    if (!date) return fallback;
    try {
        return date.toLocaleString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return fallback;
    }
}

/** "YYYY-MM-DD" key from a timestamp/matchDate (local date parts); empty string on bad data. */
export function safeDateKey(value: unknown, fallback = ''): string {
    const date = toValidDate(value);
    if (!date) return fallback;
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** Optional numeric score — undefined when missing or non-numeric. */
export function safeScore(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Percent value for confidence/win rates — 0 when missing or non-numeric. */
export function safePercent(value: unknown): number {
    return safeNumber(value);
}
