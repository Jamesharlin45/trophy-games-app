/** Constant-time string comparison for cron secrets. */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Cron authorization, matching the project's existing CRON_SECRET pattern:
 * the `x-cron-secret` header (used by GitHub Actions) or Vercel Cron's
 * `Authorization: Bearer <CRON_SECRET>` header.
 */
export function isCronRequestAuthorized(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false;

    const headerSecret = req.headers.get('x-cron-secret');
    if (headerSecret && safeEqual(headerSecret, secret)) return true;

    const authorization = req.headers.get('authorization');
    return authorization !== null && safeEqual(authorization, `Bearer ${secret}`);
}
