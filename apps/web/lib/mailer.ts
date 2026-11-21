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
            // Port 465 speaks implicit TLS; other ports use STARTTLS if the
            // server advertises it (nodemailer attempts it automatically).
            secure: config.port === 465,
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
        return { ok: false, error: `SMTP send failed: ${detail}` };
    }
}
