import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/app/client-error — public.
 *
 * The mobile app calls this from its global error handlers so crash
 * diagnostics reach the server even when the user closes the app.
 * Accepts { message, stack, appVersion, platform, screen }; `message` is
 * capped at 500 chars and `stack` at 4000. A simple in-memory per-IP rate
 * limit keeps the log from being spammed. Writes one console.error line
 * prefixed with [client-error] and returns 200.
 *
 * proxy.ts intentionally does not put /api/app/* behind Basic Auth — the
 * app calls these routes without admin credentials.
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

const RATE_WINDOW_MS = 60_000;
const MAX_RATE_PER_WINDOW = 20;
const MAX_TRACKED_IPS = 1000;

const recentRequests = new Map<string, number[]>();

function clientIp(request: Request): string {
    const forwarded = request.headers.get('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return first;
    return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Returns true when the IP is over the per-window limit (and records the
 * current call for the ones under it). */
function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const recent = (recentRequests.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= MAX_RATE_PER_WINDOW) return true;
    recentRequests.set(ip, [...recent, now]);
    if (recentRequests.size > MAX_TRACKED_IPS) {
        for (const [key, times] of recentRequests) {
            if (times.every((t) => now - t >= RATE_WINDOW_MS)) recentRequests.delete(key);
        }
    }
    return false;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

export async function POST(request: Request): Promise<Response> {
    const ip = clientIp(request);
    if (isRateLimited(ip)) {
        return NextResponse.json({ error: 'Too many client error reports' }, { status: 429 });
    }

    let body: Record<string, unknown>;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const message = readString(body.message)?.slice(0, MAX_MESSAGE).replace(/\s*\n\s*/g, ' ') ?? '';
    const stack = readString(body.stack)?.slice(0, MAX_STACK).replace(/\s*\n\s*/g, ' ') ?? '';
    const appVersion = readString(body.appVersion) ?? '';
    const platform = readString(body.platform) ?? '';
    const screen = readString(body.screen) ?? '';

    console.error(
        `[client-error] appVersion=${appVersion} platform=${platform} screen=${screen} message=${message}` +
            (stack ? ` stack=${stack}` : ''),
    );

    return NextResponse.json({ ok: true }, { status: 200 });
}
