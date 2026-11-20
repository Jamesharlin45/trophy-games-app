/**
 * Single source of truth for the API-Football key.
 *
 * The key is a 32-character API-Sports key sent only in the
 * `x-apisports-key` header. It is normalised here (trimmed, surrounding
 * quotes and carriage returns removed) and validated before any request.
 * Error messages never contain the key itself.
 */

export type ApiFootballErrorCode =
    | 'MISSING_KEY'
    | 'INVALID_KEY'
    | 'PLAN_LIMIT'
    | 'API_FAILURE';

export class ApiFootballError extends Error {
    code: ApiFootballErrorCode;

    constructor(message: string, code: ApiFootballErrorCode) {
        super(message);
        this.name = 'ApiFootballError';
        this.code = code;
    }
}

const API_FOOTBALL_KEY_LENGTH = 32;

/** Trim, drop carriage returns and remove one pair of surrounding quotes. */
export function normalizeApiFootballKey(raw: string): string {
    let key = raw.replace(/\r/g, '').trim();
    const first = key.charAt(0);
    const last = key.charAt(key.length - 1);
    if (key.length >= 2 && (first === '"' || first === "'") && first === last) {
        key = key.slice(1, -1).trim();
    }
    return key;
}

/**
 * Read and validate process.env.API_FOOTBALL_KEY.
 *
 * This is the only place in apps/web that reads the variable. Throws an
 * ApiFootballError with a key-free message when it is missing or malformed.
 */
export function getApiFootballKey(): string {
    const raw = process.env.API_FOOTBALL_KEY;
    if (raw === undefined || raw.trim() === '') {
        throw new ApiFootballError('API_FOOTBALL_KEY is not configured', 'MISSING_KEY');
    }

    const key = normalizeApiFootballKey(raw);
    if (key.length !== API_FOOTBALL_KEY_LENGTH) {
        throw new ApiFootballError(
            `API_FOOTBALL_KEY must be 32 characters, found ${key.length}`,
            'INVALID_KEY',
        );
    }

    return key;
}
