/** Helpers for the admin email diagnostics. Only booleans and redacted error
 * strings ever leave the server — never SMTP credentials or their values. */

export const SMTP_ENV_NAMES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const;

export type SmtpEnvName = (typeof SMTP_ENV_NAMES)[number];

export function smtpConfigFlags(): Record<SmtpEnvName, boolean> {
    return {
        SMTP_HOST: Boolean(process.env.SMTP_HOST),
        SMTP_PORT: Boolean(process.env.SMTP_PORT),
        SMTP_USER: Boolean(process.env.SMTP_USER),
        SMTP_PASS: Boolean(process.env.SMTP_PASS),
        MAIL_FROM: Boolean(process.env.MAIL_FROM),
    };
}

/** Replace any configured SMTP value that happens to appear in an error with
 * '[redacted]'. The remaining message is forwarded verbatim. */
export function redactSmtpSecrets(message: string): string {
    let result = message;
    for (const name of SMTP_ENV_NAMES) {
        const value = process.env[name];
        if (value && value.length > 0) {
            result = result.split(value).join('[redacted]');
        }
    }
    return result;
}
