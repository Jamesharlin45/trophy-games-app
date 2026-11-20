/**
 * Typed client for the web app's mobile API (`/api/app/*`).
 *
 * Base URL comes from EXPO_PUBLIC_API_URL and is stored without a trailing
 * slash. Every request has a timeout and throws a descriptive ApiError so
 * callers can distinguish configuration, network, timeout and HTTP failures.
 */

import type { MatchData } from '@trophy-games/shared';

const RAW_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

/** Normalised API origin, e.g. https://trophy-games-app.vercel.app */
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, '');

export const isApiConfigured = API_BASE_URL.length > 0;

/** All mobile endpoints live under this prefix on the web app. */
const API_PREFIX = '/api/app';

export type ApiErrorCode = 'config' | 'network' | 'timeout' | 'http' | 'parse';

export class ApiError extends Error {
    readonly code: ApiErrorCode;
    readonly status: number | null;
    readonly body: unknown;

    constructor(
        message: string,
        code: ApiErrorCode,
        status: number | null = null,
        body: unknown = null,
    ) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        this.body = body;
    }
}

export function toApiError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof Error) return new ApiError(error.message, 'network');
    return new ApiError(String(error), 'network');
}

// ---------------------------------------------------------------------------
// Response types (mirror the JSON bodies of apps/web/app/api/app/*)
// ---------------------------------------------------------------------------

export type MatchTier = 'free' | 'paid' | 'vip' | 'unassigned';

/** A match document as returned by the API (same shape as the old Convex doc). */
export type ApiMatch = MatchData & { _id?: string };

export interface ApiUser {
    _id: string;
    username: string;
    deviceId: string;
    createdAt: string;
    lastActiveAt?: string;
    isBlocked?: boolean;
    failedAttempts?: number;
    lastFailedAt?: string;
}

export interface ApiAlert {
    _id: string;
    title: string;
    body: string;
    deviceId?: string;
    data?: unknown;
    readBy: string[];
    createdAt: string;
}

export type MembershipRequestStatus = 'pending' | 'approved' | 'rejected';

export type MembershipStatus =
    | { status: 'active'; token: string; matchId?: string }
    | { status: 'none' }
    | { status: MembershipRequestStatus; requestId: string };

export type ClaimTokenResult =
    | { success: false; reason: string }
    | { success: true; type: MatchTier; matchId?: string };

export type VerifyTokenResult =
    | { valid: false; reason: string }
    | { valid: true; type: MatchTier; matchId?: string };

export type MembershipRequestResult =
    | { success: true; requestId: string }
    | { success: false; reason: string; requestId?: string };

export type RecordPurchaseResult =
    | { success: false; reason: string }
    | { success: true; alreadyRecorded: true; token: string }
    | {
          success: true;
          alreadyRecorded: false;
          token: string;
          tier: 'vip' | 'paid';
          expiresAt: string;
      };

export interface ActiveSubscription {
    tier: 'vip' | 'paid';
    productId: string;
    expiresAt?: string;
    purchaseToken: string;
    transactionId?: string;
}

export interface RegisterUserResult {
    success: boolean;
    reason?: string;
}

export interface CheckUsernameResult {
    available: boolean;
}

export type RequestQuery = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
    method?: 'GET' | 'POST';
    query?: RequestQuery;
    body?: unknown;
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;

function buildQuery(query: RequestQuery | undefined): string {
    if (!query) return '';
    const parts: string[] = [];
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function readErrorMessage(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const record = body as Record<string, unknown>;
    const candidate = record.error ?? record.reason ?? record.message;
    return typeof candidate === 'string' ? candidate : null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!isApiConfigured) {
        throw new ApiError(
            'EXPO_PUBLIC_API_URL is not set. Configure it before building the app.',
            'config',
        );
    }

    const url = `${API_BASE_URL}${API_PREFIX}${path}${buildQuery(options.query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(url, {
            method: options.method ?? 'GET',
            headers: {
                Accept: 'application/json',
                ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new ApiError(`Request timed out: ${path}`, 'timeout');
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new ApiError(`Network request failed: ${path} (${detail})`, 'network');
    } finally {
        clearTimeout(timeout);
    }

    const rawBody = await response.text();
    let body: unknown = null;
    if (rawBody.length > 0) {
        try {
            body = JSON.parse(rawBody) as unknown;
        } catch {
            throw new ApiError(
                `Invalid JSON from ${path} (HTTP ${response.status})`,
                'parse',
                response.status,
            );
        }
    }

    if (!response.ok) {
        const message =
            readErrorMessage(body) ?? `Request failed with HTTP ${response.status}: ${path}`;
        throw new ApiError(message, 'http', response.status, body);
    }

    return body as T;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const api = {
    matches: {
        byTypeAndDate: (matchType: MatchTier, date: string, limit?: number) =>
            request<ApiMatch[]>('/matches/by-type-and-date', {
                query: { matchType, date, limit },
            }),
        byDate: (date: string) =>
            request<ApiMatch[]>('/matches/by-date', { query: { date } }),
        all: (limit?: number) =>
            request<ApiMatch[]>('/matches/all', { query: { limit } }),
        history: (limit?: number) =>
            request<ApiMatch[]>('/matches/history', { query: { limit } }),
        byId: (matchId: string) =>
            request<ApiMatch | null>('/matches/by-id', { query: { matchId } }),
    },

    users: {
        register: (username: string, deviceId: string) =>
            request<RegisterUserResult>('/users/register', {
                method: 'POST',
                body: { username, deviceId },
            }),
        checkUsername: (username: string) =>
            request<CheckUsernameResult>('/users/check-username', { query: { username } }),
        byDevice: (deviceId: string) =>
            request<ApiUser | null>('/users/by-device', { query: { deviceId } }),
    },

    tokens: {
        createMembershipRequest: (
            deviceId: string,
            type: 'vip' | 'paid',
            username?: string,
        ) =>
            request<MembershipRequestResult>('/tokens/create-membership-request', {
                method: 'POST',
                body: { deviceId, type, username },
            }),
        requestMembership: (deviceId: string, type: 'vip' | 'paid', username?: string) =>
            request<MembershipRequestResult>('/tokens/request-membership', {
                method: 'POST',
                body: { deviceId, type, username },
            }),
        claimToken: (token: string, deviceId: string, username?: string) =>
            request<ClaimTokenResult>('/tokens/claim-token', {
                method: 'POST',
                body: { token, deviceId, username },
            }),
        verifyToken: (token: string, deviceId: string, username?: string) =>
            request<VerifyTokenResult>('/tokens/verify-token', {
                method: 'POST',
                body: { token, deviceId, username },
            }),
        getMembershipStatus: (
            deviceId: string,
            type: 'vip' | 'paid',
            username?: string,
        ) =>
            request<MembershipStatus | null>('/tokens/get-membership-status', {
                query: { deviceId, type, username },
            }),
    },

    purchases: {
        recordPurchase: (input: {
            deviceId: string;
            productId: string;
            purchaseToken: string;
            transactionId?: string;
            receiptData?: string;
        }) =>
            request<RecordPurchaseResult>('/purchases/record-purchase', {
                method: 'POST',
                body: input,
            }),
        getActiveSubscription: (deviceId: string) =>
            request<ActiveSubscription | null>('/purchases/get-active-subscription', {
                query: { deviceId },
            }),
    },

    alerts: {
        getAlerts: (deviceId?: string) =>
            request<ApiAlert[]>('/alerts/get-alerts', { query: { deviceId } }),
        markRead: (alertId: string, deviceId: string) =>
            request<null>('/alerts/mark-read', {
                method: 'POST',
                body: { alertId, deviceId },
            }),
        markAllRead: (deviceId: string) =>
            request<null>('/alerts/mark-all-read', {
                method: 'POST',
                body: { deviceId },
            }),
    },

    devices: {
        registerPushToken: (deviceId: string, pushToken: string) =>
            request<null>('/devices/register-push-token', {
                method: 'POST',
                body: { deviceId, pushToken },
            }),
    },
};

export type ApiClient = typeof api;
