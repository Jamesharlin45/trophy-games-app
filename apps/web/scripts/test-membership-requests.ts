/**
 * No-network tests for request-access idempotency (B): lib/db/tokens.ts
 * requestMembership — a repeat request from the same device returns
 * success with the existing request id (alreadyPending: true), other
 * failures return a clear reason. A fake Supabase client stands in for
 * the database so no network is involved.
 * Run with: bun apps/web/scripts/test-membership-requests.ts
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { requestMembership } from '../lib/db/tokens';

const DEVICE_ID = '5f1f4c3e-7b2a-4f1e-9d3c-8a6b2f0d1e22';
const EMAIL = 'user@example.com';

interface FakeOpts {
    /** Rows returned by the "pending request exists" query. */
    pending?: { id: string }[] | null;
    /** Rows returned by the per-device rate-limit query. */
    recent?: { id: string }[] | null;
}

interface FakeDb {
    db: SupabaseClient;
    insertCalls: Record<string, unknown>[];
}

/** Minimal chainable fake covering the queries requestMembership runs. */
function fakeDb(opts: FakeOpts): FakeDb {
    const insertCalls: Record<string, unknown>[] = [];

    /** A fresh query chain per `from()` call (the real client does the same). */
    const makeChain = (): Record<string, unknown> => {
        const filters: Record<string, unknown> = {};
        let insertRow: Record<string, unknown> | null = null;
        const chain: Record<string, unknown> = {
            select: () => chain,
            eq: (col: string, value: unknown) => {
                filters[col] = value;
                return chain;
            },
            gte: (col: string, value: unknown) => {
                filters[col] = value;
                return chain;
            },
            limit: () => {
                if (insertRow) return { data: [{ id: 'new-request-id' }], error: null };
                if (filters.status === 'pending') return { data: opts.pending ?? null };
                if (filters.requested_at !== undefined) return { data: opts.recent ?? null };
                return { data: null };
            },
            insert: (row: Record<string, unknown>) => {
                insertCalls.push(row);
                insertRow = row;
                return chain;
            },
        };
        return chain;
    };

    return { db: { from: () => makeChain() } as unknown as SupabaseClient, insertCalls };
}

let passed = 0;
const failures: string[] = [];

function check(actual: unknown, expected: unknown, note: string): void {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        passed += 1;
        console.log(`PASS  ${note}`);
    } else {
        failures.push(`FAIL  ${note}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        console.error(failures[failures.length - 1]);
    }
}

// --- Repeat request is idempotent (B) --------------------------------------
{
    const { db, insertCalls } = fakeDb({ pending: [{ id: 'req-123' }] });
    const result = await requestMembership(db, { deviceId: DEVICE_ID, type: 'paid', email: EMAIL });
    check(result, { success: true, requestId: 'req-123', alreadyPending: true }, 'repeat request -> idempotent success');
    check(insertCalls.length, 0, 'repeat request does not insert a new row');
}

// --- Repeat beats the rate limit (idempotency first) -----------------------
{
    const { db } = fakeDb({
        pending: [{ id: 'req-123' }],
        recent: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
    });
    const result = await requestMembership(db, { deviceId: DEVICE_ID, type: 'vip', email: EMAIL });
    check(result, { success: true, requestId: 'req-123', alreadyPending: true }, 'repeat with recent rows -> idempotent success');
}

// --- Fresh request inserts a pending row -----------------------------------
{
    const { db, insertCalls } = fakeDb({ pending: null, recent: null });
    const result = await requestMembership(db, { deviceId: DEVICE_ID, type: 'paid', email: EMAIL });
    check(result, { success: true, requestId: 'new-request-id' }, 'fresh request -> new requestId');
    check(insertCalls.length, 1, 'fresh request inserts one row');
    check(insertCalls[0]?.status, 'pending', 'fresh request inserts status pending');
    check(insertCalls[0]?.device_id, DEVICE_ID, 'fresh request inserts the device id');
}

// --- Rate limit still returns a clear reason -------------------------------
{
    const { db } = fakeDb({ pending: null, recent: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] });
    const result = await requestMembership(db, { deviceId: DEVICE_ID, type: 'paid', email: EMAIL });
    check(result, { success: false, reason: 'Rate limited: please try again later' }, 'rate limited -> clear reason');
}

// --- Other failures return clear reasons -----------------------------------
{
    const { db } = fakeDb({});
    const badDevice = await requestMembership(db, { deviceId: 'not-a-device', type: 'paid', email: EMAIL });
    check(badDevice, { success: false, reason: 'Invalid device id' }, 'invalid deviceId -> clear reason');
}
{
    const { db } = fakeDb({});
    const badEmail = await requestMembership(db, { deviceId: DEVICE_ID, type: 'paid', email: 'not-an-email' });
    check(badEmail, { success: false, reason: 'Invalid email address' }, 'invalid email -> clear reason');
}

console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length > 0) process.exit(1);
console.log('All membership request tests passed.');
