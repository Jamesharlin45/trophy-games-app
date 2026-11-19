import { NextResponse } from 'next/server';
import { createDb } from '@/lib/db/client';
import { approveAnalysis } from '@/lib/db/analysis';

// POST /api/analysis/approve - Approve analysis and apply match types
export async function POST(req: Request) {
    const db = createDb();
    if (!db) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    try {
        const { resultId, selectedMatchIds, approveFree, approvePaid, approveVip } =
            (await req.json()) as {
                resultId?: string;
                selectedMatchIds?: string[];
                approveFree?: boolean;
                approvePaid?: boolean;
                approveVip?: boolean;
            };

        if (!resultId) {
            return NextResponse.json({ error: 'Missing resultId' }, { status: 400 });
        }

        const result = await approveAnalysis(db, {
            resultId,
            approvedBy: 'admin',
            selectedMatchIds,
            approveFree,
            approvePaid,
            approveVip,
        });

        return NextResponse.json(result);
    } catch (error) {
        console.error('[Analysis API] Approve failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Approval failed' }, { status: 500 });
    }
}
