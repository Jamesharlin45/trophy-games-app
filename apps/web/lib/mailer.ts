/**
 * Server-only SMTP mailer for the token-email feature.
 *
 * Configured purely by environment variables (nothing else is read, and the
 * mailer never logs credentials or email bodies):
 *   SMTP_HOST   — SMTP server host (e.g. smtp.gmail.com)
 *   SMTP_PORT   — SMTP port (e.g. 587 or 465)
 *   SMTP_USER   — SMTP login (the sending address)
 *   SMTP_PASS   — SMTP password (an app password for Gmail, Brevo, …)
 *   MAIL_FROM   — "From" address used on every message
 *
 * sendMail() returns the SMTP errors as plain strings instead of throwing, so
 * callers (the outbox sender) can store them in last_error without any risk
 * of logging secrets.
 */

import nodemailer from 'nodemailer';

export interface MailerSendInput {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

export type MailerSendResult = { ok: true } | { ok: false; error: string };

export interface SmtpConfig {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
}

/** Read the SMTP configuration from the environment. Returns an object with
 * `error` naming the first missing or invalid variable, so callers get a
 * clear message. */
export function getSmtpConfig(): SmtpConfig | { error: string } {
    const host = process.env.SMTP_HOST;
    const portRaw = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.MAIL_FROM;
    if (!host) return { error: 'Missing required environment variable: SMTP_HOST' };
    if (!portRaw) return { error: 'Missing required environment variable: SMTP_PORT' };
    if (!user) return { error: 'Missing required environment variable: SMTP_USER' };
    if (!pass) return { error: 'Missing required environment variable: SMTP_PASS' };
    if (!from) return { error: 'Missing required environment variable: MAIL_FROM' };
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { error: `Invalid SMTP_PORT value: ${JSON.stringify(portRaw)}` };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
        return { error: 'Invalid MAIL_FROM value: expected a full email address' };
    }
    return { host, port, user, pass, from };
}

/** Send one email through the configured SMTP server. */
export async function sendMail(input: MailerSendInput): Promise<MailerSendResult> {
    const config = getSmtpConfig();
    if ('error' in config) {
        return { ok: false, error: config.error };
    }

    try {
        const transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            // Implicit TLS only on 465. On 587 (and any other submission port)
            // require STARTTLS — never silently fall back to cleartext.
            secure: config.port === 465,
            requireTLS: config.port !== 465,
            auth: { user: config.user, pass: config.pass },
        });
        await transporter.sendMail({
            from: config.from,
            to: input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
        });
        return { ok: true };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        // Gmail rejects normal account passwords with a 535/EAUTH error. The
        // hint contains no secret and saves a long debugging detour.
        const gmailHint =
            config.host.toLowerCase().includes('gmail') &&
            /(^|\s)(535|EAUTH)\b|invalid login|application-specific password/i.test(detail)
                ? ' For Gmail, use a 16-character Google App Password as SMTP_PASS (not your account password).'
                : '';
        return { ok: false, error: `SMTP send failed: ${detail}${gmailHint}` };
    }
}
