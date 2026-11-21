import { createDb } from '@/lib/db/client';
import { sendDueEmails } from '@/lib/db/email-outbox';

/**
 * Opportunistic trigger for due outbox rows.
 *
 * Every /api/app/* endpoint calls triggerDueEmailsIfDue() so a due email can
 * go out even if the cron does not run (e.g. its schedule drifts). The check
 * is a single Date.now() comparison — negligible — and the send runs detached,
 * so the main request is never slowed or failed by it. At most one run per
 * minute.
 */

const MIN_INTERVAL_MS = 60_000;

let lastTriggerAt = 0;
let inFlight = false;

export function triggerDueEmailsIfDue(): void {
    const now = Date.now();
    if (now - lastTriggerAt < MIN_INTERVAL_MS) return;
    if (inFlight) return;
    lastTriggerAt = now;
    inFlight = true;
    void (async () => {
        try {
            const db = createDb();
            if (!db) return;
            await sendDueEmails(db);
        } catch (error) {
            // Opportunistic only — never let this fail or slow the request.
            console.warn('[Opportunistic emails] sendDueEmails failed:', error);
        } finally {
            inFlight = false;
        }
    })();
}
