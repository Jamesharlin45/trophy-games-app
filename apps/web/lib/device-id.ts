/**
 * One helper module for device-id validation and display.
 *
 * The app used to send a package/version string that was identical for every
 * install (e.g. "com.khanblair.trophygames_1.0.0"). New installs send a random
 * per-install UUID. Both shapes are accepted on writes while old app versions
 * are still in the wild; LEGACY_DEVICE_ACCESS controls whether legacy ids get
 * any access in read/verify paths.
 */

/** Prefix used by every legacy (package/version based) device id. */
export const LEGACY_DEVICE_PREFIX = 'com.khanblair.trophygames';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID (any version), case-insensitive. */
export function isUuid(value: string): boolean {
    return UUID_PATTERN.test(value.trim());
}

/** True for the old non-unique package/version device ids. */
export function isLegacyDeviceId(value: string): boolean {
    return value.startsWith(LEGACY_DEVICE_PREFIX);
}

/**
 * Accept a UUID for new writes, but keep accepting legacy ids so old app
 * versions keep working. Random strings are rejected.
 */
export function isValidDeviceId(value: string): boolean {
    const trimmed = value.trim();
    return isUuid(trimmed) || isLegacyDeviceId(trimmed);
}

/**
 * Short, copyable display code: "TG-1A2B-3C4D" for a UUID. Legacy rows get a
 * clear marker instead of a misleading code; the full id is always available
 * via the table's copy action.
 */
export function getDeviceDisplayCode(value: string): string {
    if (isLegacyDeviceId(value)) return 'TG-LEGACY';
    const hex = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
    if (hex.length < 8) return 'TG-????????';
    const firstEight = hex.slice(0, 8);
    return `TG-${firstEight.slice(0, 4)}-${firstEight.slice(4)}`;
}

/**
 * Server-side access gate. LEGACY_DEVICE_ACCESS="false" disables access for
 * legacy ids; every other value (including an unset variable) keeps the old
 * behaviour so existing installs are not locked out by accident.
 */
export function legacyDeviceAccessAllowed(): boolean {
    return process.env.LEGACY_DEVICE_ACCESS !== 'false';
}

/** Reason returned by access endpoints when legacy access is disabled. */
export const LEGACY_ACCESS_DENIED_REASON = 'Please update the app to continue.';
