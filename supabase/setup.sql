-- supabase/setup.sql
--
-- Single-run Supabase setup for Trophy Games (web admin, apps/web).
--
-- Paste the entire file into the Supabase SQL Editor and run it once:
--   - Postgres 13+ (gen_random_uuid() is built in; the pgcrypto extension is
--     required on older versions).
--   - Idempotent / safe to run twice: CREATE TABLE and CREATE INDEX use IF NOT
--     EXISTS; policies use DROP POLICY IF EXISTS + CREATE POLICY.
--   - If the older supabase/schema.sql was already applied to this database
--     and created a `matches` table with the old columns, drop that table
--     first (DROP TABLE IF EXISTS matches CASCADE;). This file never alters an
--     existing `matches` table.
--
-- Field-name mapping for the `matches` table (per spec):
--   teams        -> home_team + away_team (the existing homeTeam/awayTeam fields)
--   league       -> league
--   kickoff      -> kickoff (the existing `timestamp` field, now timestamptz)
--   score        -> score
--   status       -> status
--   result       -> result ('pending' | 'win' | 'lose' | 'draw')
--   tier         -> tier (the existing `matchType` field: 'free'|'paid'|'vip'|'unassigned')
--   odds         -> odds (jsonb)
--   trending     -> trending (the existing `isTrending` field)
--   isHistory    -> is_history
--   matchDate    -> match_date
--   aiPrediction -> ai_prediction (jsonb; shape:
--                    {"prediction": string, "confidence": number,
--                     "suggestedBet"?: string, "reasoning": string[],
--                     "generatedAt": string})
--
-- Access rules for `matches`: deny-by-default like the other tables — RLS
-- enabled, no read or write policies, and PUBLIC / anon / authenticated
-- hold no privileges. The service_role key (the Postgres connection role
-- behind it bypasses RLS unless FORCE ROW LEVEL SECURITY is enabled) is the
-- only way to read or write. Re-running the file removes access granted
-- earlier.

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    home_team text NOT NULL,
    away_team text NOT NULL,
    league text NOT NULL,
    kickoff timestamptz NOT NULL,
    score text NOT NULL,
    status text NOT NULL,
    result text NULL CHECK (result IN ('pending', 'win', 'lose', 'draw')),
    tier text NULL CHECK (tier IN ('free', 'paid', 'vip', 'unassigned')),
    odds jsonb NULL,
    trending boolean NULL,
    is_history boolean NULL,
    match_date text NULL,
    ai_prediction jsonb NULL,
    -- Web-created matches keep their external string id here (e.g. the
    -- `manual-<timestamp>` ids the admin dashboard generates) — the schema's
    -- `id` column alone cannot hold non-UUID external ids.
    external_id text NULL UNIQUE,
    -- Rich per-match detail fields written back by the web dashboard
    -- (enrichMatch: homeForm, potentials, h2h, detailedOdds, ...). No
    -- dedicated columns exist for them, so they live in this jsonb.
    details jsonb NULL
);

CREATE INDEX IF NOT EXISTS matches_by_tier ON matches (tier);
CREATE INDEX IF NOT EXISTS matches_by_trending ON matches (trending);
CREATE INDEX IF NOT EXISTS matches_by_match_date ON matches (match_date);
CREATE INDEX IF NOT EXISTS matches_by_history ON matches (is_history);

-- Access rules (existing: RLS enabled — same as the other tables).
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Deny-by-default like the other tables: no read or write policies are
-- created, and PUBLIC / anon / authenticated hold no privileges. Re-running
-- the file also removes access granted earlier.
REVOKE ALL ON matches FROM PUBLIC, anon, authenticated;

-- Reads and writes stay with the service_role key: there are deliberately no
-- read or write policies, so the service_role connection role is the only
-- non-owner that can access the table (it bypasses RLS unless FORCE ROW
-- LEVEL SECURITY is enabled).

-- ---------------------------------------------------------------------------
-- leagues
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leagues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    old_id double precision NOT NULL, -- doc field id (v.number); name changed, new id is taken
    name text NOT NULL,
    url text NULL,
    logo text NULL,
    type text NULL,
    match_count double precision NULL,
    country text NULL,
    country_id double precision NULL,
    country_flag text NULL
);

CREATE INDEX IF NOT EXISTS leagues_by_league_id ON leagues (old_id);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- access_tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS access_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    convex_created_at text NOT NULL, -- doc field createdAt
    token text NOT NULL,
    type text NOT NULL CHECK (type IN ('vip', 'paid')),
    device_id text NOT NULL,
    username text NULL,
    match_id text NULL,
    expires_at text NULL,
    is_active boolean NOT NULL,
    is_claimed boolean NOT NULL,
    claimed_at text NULL,
    failed_attempts double precision NULL
);

CREATE INDEX IF NOT EXISTS access_tokens_by_token ON access_tokens (token);
CREATE INDEX IF NOT EXISTS access_tokens_by_device_id ON access_tokens (device_id);
CREATE INDEX IF NOT EXISTS access_tokens_by_username ON access_tokens (username);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE access_tokens ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- membership_requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS membership_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    device_id text NOT NULL,
    username text NULL,
    type text NOT NULL CHECK (type IN ('vip', 'paid')),
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at text NOT NULL,
    resolved_at text NULL,
    issued_token text NULL
);

CREATE INDEX IF NOT EXISTS membership_requests_by_device_id ON membership_requests (device_id);
CREATE INDEX IF NOT EXISTS membership_requests_by_username ON membership_requests (username);
CREATE INDEX IF NOT EXISTS membership_requests_by_status ON membership_requests (status);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE membership_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    convex_created_at text NOT NULL,
    username text NOT NULL,
    device_id text NOT NULL,
    last_active_at text NULL,
    is_blocked boolean NULL,
    failed_attempts double precision NULL,
    last_failed_at text NULL
);

CREATE INDEX IF NOT EXISTS users_by_username ON users (username);
CREATE INDEX IF NOT EXISTS users_by_device_id ON users (device_id);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    device_id text NOT NULL,
    push_token text NULL,
    last_active_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_by_device_id ON devices (device_id);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- alerts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    convex_created_at text NOT NULL,
    device_id text NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb NULL,
    read_by jsonb NULL
);

CREATE INDEX IF NOT EXISTS alerts_by_device_id ON alerts (device_id);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- purchases
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    convex_created_at text NOT NULL,
    device_id text NOT NULL,
    product_id text NOT NULL,
    tier text NOT NULL CHECK (tier IN ('vip', 'paid')),
    purchase_token text NOT NULL,
    transaction_id text NULL,
    status text NOT NULL CHECK (status IN ('pending', 'verified', 'expired', 'refunded')),
    receipt_data text NULL,
    verified_at text NULL,
    expires_at text NULL,
    updated_at text NULL
);

CREATE INDEX IF NOT EXISTS purchases_by_device_id ON purchases (device_id);
CREATE INDEX IF NOT EXISTS purchases_by_purchase_token ON purchases (purchase_token);
CREATE INDEX IF NOT EXISTS purchases_by_status ON purchases (status);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- Backup email address (where the access token is mailed). ADD COLUMN IF NOT
-- EXISTS keeps this file safe to re-run on databases created earlier.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS email text NULL;

-- ---------------------------------------------------------------------------
-- analysis_results
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analysis_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    convex_created_at text NOT NULL,
    date text NOT NULL,
    analysis_type text NOT NULL CHECK (analysis_type IN ('daily', 'weekly')),
    status text NOT NULL CHECK (status IN ('pending', 'verified', 'approved', 'rejected')),
    free_recommendations jsonb NOT NULL,
    paid_recommendations jsonb NOT NULL,
    vip_recommendations jsonb NOT NULL,
    verification_notes jsonb NULL,
    removed_matches jsonb NULL,
    confidence_adjustment double precision NULL,
    generated_at text NOT NULL,
    verified_at text NULL,
    approved_at text NULL,
    approved_by text NULL,
    model text NOT NULL,
    updated_at text NULL,
    -- Per-match proposals stored while Run Analysis is in progress; matches
    -- get ai_prediction/tier only when this split is approved.
    proposals jsonb NULL
);

CREATE INDEX IF NOT EXISTS analysis_results_by_date ON analysis_results (date);
CREATE INDEX IF NOT EXISTS analysis_results_by_status ON analysis_results (status);
CREATE INDEX IF NOT EXISTS analysis_results_by_analysis_type ON analysis_results (analysis_type);

-- Access rules (existing: RLS enabled, no policies).
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- email_outbox
-- ---------------------------------------------------------------------------
-- Token-email outbox. Rows are created by POST /api/app/purchases/set-email
-- (the mobile app right after a successful Google Play purchase) and sent by
-- GET /api/cron/send-emails. The token column holds the app access token
-- (access_tokens.token); purchase_id links back to the purchases row.

CREATE TABLE IF NOT EXISTS email_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email text NOT NULL,
    subject text NOT NULL,
    body_text text NOT NULL,
    body_html text NULL,
    token text NOT NULL,
    purchase_id uuid NULL,
    send_after timestamptz NOT NULL,
    sent_at timestamptz NULL,
    cancelled_at timestamptz NULL,
    attempts integer NOT NULL DEFAULT 0,
    last_error text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_outbox_by_send_after ON email_outbox (sent_at, send_after);

-- Access rules (same deny-by-default as the other tables): RLS enabled with
-- no policies, and no privileges granted to PUBLIC / anon / authenticated.
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_outbox FROM PUBLIC, anon, authenticated;
