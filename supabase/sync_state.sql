-- supabase/sync_state.sql
--
-- Production shape of the singleton `sync_state` row:
--   id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
--   last_synced_at timestamptz NOT NULL
-- plus the nullable `results_synced_at` column used as the results-sync
-- throttle marker by apps/web/lib/sync-results.ts (fixtures sync writes
-- last_synced_at, lib/sync-fixtures.ts).
--
-- All statements are idempotent (CREATE/ALTER ... IF NOT EXISTS): safe to run
-- against an existing database. This file never drops anything.

CREATE TABLE IF NOT EXISTS sync_state (
    id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_synced_at timestamptz NOT NULL,
    results_synced_at timestamptz NULL
);

-- Access rules (same as the other tables): deny by default, the service_role
-- key is the only non-owner that can use the table.
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sync_state FROM PUBLIC, anon, authenticated;

-- Add the nullable column to databases created before it existed.
ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS results_synced_at timestamptz;
