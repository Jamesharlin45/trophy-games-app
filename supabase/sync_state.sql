-- supabase/sync_state.sql
--
-- Table for the results-sync throttle: syncResults (lib/sync-results.ts)
-- records the last run in sync_state.results_synced_at and returns early when
-- it is younger than RESULTS_SYNC_MIN_INTERVAL_MS (3 hours). The `matches`
-- table itself already exists (supabase/setup.sql).
--
-- Run this once in the Supabase SQL Editor (paste and run). Not run by the
-- repo. The ALTER statement below keeps this file safe to re-run.

CREATE TABLE IF NOT EXISTS sync_state (
    id text PRIMARY KEY,
    results_synced_at timestamptz NULL
);

-- Access rules (same pattern as the other tables): deny by default, the
-- service_role key is the only non-owner that can use the table.
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sync_state FROM PUBLIC, anon, authenticated;

ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS results_synced_at timestamptz;
