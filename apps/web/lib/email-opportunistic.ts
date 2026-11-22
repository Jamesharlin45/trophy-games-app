import { after } from 'next/server';
import { createDb } from '@/lib/db/client';
import { sendDueEmails } from '@/lib/db/email-outbox';

/**
 * Schedule a send of all currently due outbox rows.
 *
 * The old implementation started a detached, un-awaited promise. On Vercel the
 * runtime freezes that promise as soon as the response is returned, so the SMTP
 * send never happened. `after()` registers the work with the platform's wait
 * mechanism: it runs after the response is flushed while the invocation is
 * still kept alive. The outbox and /api/cron/send-emails remain the retry net.
 *
 * Nothing here handles tokens or credentials, and no token value is logged.
 */
export function scheduleDueEmails(): void {
    after(async () => {
        try {
            const db = createDb();
            if (!db) return;
            await sendDueEmails(db);
        } catch (error) {
            // Only a generic message: SMTP errors themselves are stored on the
            // outbox row's last_error by sendDueEmails() for admin diagnostics.
            console.error(
                '[Email] Background send failed:',
                error instanceof Error ? error.message : 'unknown error',
            );
        }
    });
}

/** Backwards-compatible name used by the existing /api/app/* routes. */
export const triggerDueEmailsIfDue = scheduleDueEmails;
