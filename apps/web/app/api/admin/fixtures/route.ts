import { NextResponse } from 'next/server';
import { ApiFootballError, fetchFixtures } from '@/lib/api-football';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC date string (YYYY-MM-DD) for `offsetDays` from today. */
function utcDate(offsetDays: number): string {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)
    ).toISOString().slice(0, 10);
}

// GET — Fixtures for one date within yesterday..tomorrow (UTC), via the
// API-Football helper. Error mapping: 500 missing key, 429 plan limit,
// 502 API failure. An empty result is a 200 with an empty list.
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');

    if (!date || !DATE_RE.test(date)) {
        return NextResponse.json(
            { error: 'date is required and must be in YYYY-MM-DD format' },
            { status: 400 }
        );
    }

    const yesterday = utcDate(-1);
    const tomorrow = utcDate(1);
    if (date < yesterday || date > tomorrow) {
        return NextResponse.json(
            {
                error: `date must be yesterday, today, or tomorrow (UTC). Allowed range: ${yesterday} to ${tomorrow}. Got: ${date}`,
            },
            { status: 400 }
        );
    }

    try {
        const fixtures = await fetchFixtures(date);
        return NextResponse.json({ fixtures });
    } catch (error) {
        if (error instanceof ApiFootballError) {
            const status = error.code === 'MISSING_KEY' ? 500 : error.code === 'PLAN_LIMIT' ? 429 : 502;
            return NextResponse.json({ error: error.message }, { status });
        }
        console.error('[Admin Fixtures API] Failed to fetch fixtures:', error);
        return NextResponse.json({ error: 'Failed to fetch fixtures from API-Football' }, { status: 502 });
    }
}
