import { NextResponse } from 'next/server';
import { sendMail } from '@/lib/mailer';
import { isValidEmail } from '@/lib/db/email-outbox';
import { redactSmtpSecrets } from '@/lib/email-diagnostics';

export const dynamic = 'force-dynamic';

/** POST /api/admin/email-test { to } — send one test email through the same
 * mailer as token emails. On failure the exact SMTP error is returned so the
 * admin can fix the configuration; it is redacted if it contains a secret. */
export async function POST(request: Request) {
    let body: { to?: unknown } = {};
    try {
        body = (await request.json()) as { to?: unknown };
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!isValidEmail(to)) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const result = await sendMail({
        to,
        subject: 'Trophy Games — Test email',
        text: 'This is a test email from the Trophy Games admin dashboard. Token emails use the same SMTP settings.',
    });
    if (!result.ok) {
        return NextResponse.json({ success: false, error: redactSmtpSecrets(result.error) }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}
