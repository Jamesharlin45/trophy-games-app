-- supabase/fixture_sync_log.sql
--
-- New table for throttling fixture syncs: syncFixtures (lib/sync-fixtures.ts)
-- runs at most once per date within SYNC_MIN_INTERVAL_MS (3 hours).
--
-- Run this once in the Supabase SQL Editor (paste and run). Not run by the
-- repo. The `matches` table itself already exists (supabase/setup.sql).

CREATE TABLE IF NOT EXISTS fixture_sync_log (
    date text PRIMARY KEY,
    last_synced_at timestamptz NOT NULL DEFAULT now()
);

-- Access rules (same pattern as the other tables): deny by default, the
-- service_role key is the only non-owner that can use the table.
ALTER TABLE fixture_sync_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fixture_sync_log FROM PUBLIC, anon, authenticated;
