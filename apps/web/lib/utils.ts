import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** Short display of time left until `expiresAt` ("+12d", "0 (expired)", or
 * "—" when there is no expiry). Used by the access-grant tables. */
export function daysLeftLabel(expiresAt?: string): string {
    if (!expiresAt) return '—';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return '0 (expired)';
    return `+${Math.ceil(ms / 86_400_000)}d`;
}
