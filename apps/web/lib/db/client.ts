import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side data-access layer. This file is server-only: it is imported by
 * API routes and server modules only and must never be imported from client
 * components. It builds the client from SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. The service role key must never reach
 * NEXT_PUBLIC_* variables or client components — all of these modules run
 * server-side, so the key stays private.
 */
export function createDb(): SupabaseClient | null {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) return null;
    return createClient(url, serviceRoleKey);
}
