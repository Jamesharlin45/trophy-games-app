-- Supabase migration: recreate the Convex tables from packages/backend/convex/schema.ts.
-- Notes:
--  - gen_random_uuid() requires Postgres 13+ or the pgcrypto extension.
--  - RLS is enabled on every table, but no policies are created yet, so everything
--    is denied by default until policies are added later.

-- Convex fields: id, league, leagueId, leagueLogo, homeTeam, homeTeamId, homeTeamLogo, awayTeam, awayTeamId, awayTeamLogo, country, countryFlag, timestamp, status, score, homeScore, awayScore, homeStanding, awayStanding, referee, weather, homeForm, awayForm, homeCorners, awayCorners, matchType, isTrending, aiPrediction, odds, detailedOdds, h2h, htHomeScore, htAwayScore, homeXg, awayXg, stadium, attendance, tvStations, preview, potentials, stats, goals, homeLineup, awayLineup, oddsComparison, result, matchDate, isHistory, createdAt, updatedAt, createdBy
CREATE TABLE matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    league text NOT NULL,
    league_id double precision NULL,
    league_logo text NULL,
    home_team text NOT NULL,
    home_team_id double precision NULL,
    home_team_logo text NULL,
    away_team text NOT NULL,
    away_team_id double precision NULL,
    away_team_logo text NULL,
    country text NULL,
    country_flag text NULL,
    "timestamp" text NOT NULL,
    status text NOT NULL,
    score text NOT NULL,
    home_score double precision NULL,
    away_score double precision NULL,
    home_standing double precision NULL,
    away_standing double precision NULL,
    referee text NULL,
    weather text NULL,
    home_form text NULL,
    away_form text NULL,
    home_corners double precision NULL,
    away_corners double precision NULL,
    match_type text NULL CHECK (match_type IN ('free', 'paid', 'vip', 'unassigned')),
    is_trending boolean NULL,
    ai_prediction jsonb NULL,
    odds jsonb NULL,
    detailed_odds jsonb NULL,
    h2h jsonb NULL,
    ht_home_score double precision NULL,
    ht_away_score double precision NULL,
    home_xg double precision NULL,
    away_xg double precision NULL,
    stadium text NULL,
    attendance double precision NULL,
    tv_stations jsonb NULL,
    preview text NULL,
    potentials jsonb NULL,
    stats jsonb NULL,
    goals jsonb NULL,
    home_lineup jsonb NULL,
    away_lineup jsonb NULL,
    odds_comparison jsonb NULL,
    result text NULL CHECK (result IN ('pending', 'win', 'lose', 'draw')),
    match_date text NULL,
    is_history boolean NULL,
    convex_created_at text NOT NULL, -- doc field createdAt
    updated_at text NULL,
    created_by text NULL
);

CREATE INDEX matches_by_match_id ON matches (convex_id);
CREATE INDEX matches_by_match_type ON matches (match_type);
CREATE INDEX matches_by_trending ON matches (is_trending);
CREATE INDEX matches_by_match_date ON matches (match_date);
CREATE INDEX matches_by_history ON matches (is_history);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Convex fields: id, name, url, logo, type, matchCount, country, countryId, countryFlag
CREATE TABLE leagues (
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

CREATE INDEX leagues_by_league_id ON leagues (old_id);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;

-- Convex fields: token, type, deviceId, username, matchId, expiresAt, isActive, isClaimed, claimedAt, createdAt, failedAttempts
CREATE TABLE access_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
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

CREATE INDEX access_tokens_by_token ON access_tokens (token);
CREATE INDEX access_tokens_by_device_id ON access_tokens (device_id);
CREATE INDEX access_tokens_by_username ON access_tokens (username);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE access_tokens ENABLE ROW LEVEL SECURITY;

-- Convex fields: deviceId, username, type, status, requestedAt, resolvedAt, issuedToken
CREATE TABLE membership_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    device_id text NOT NULL,
    username text NULL,
    type text NOT NULL CHECK (type IN ('vip', 'paid')),
    status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at text NOT NULL,
    resolved_at text NULL,
    issued_token text NULL
);

CREATE INDEX membership_requests_by_device_id ON membership_requests (device_id);
CREATE INDEX membership_requests_by_username ON membership_requests (username);
CREATE INDEX membership_requests_by_status ON membership_requests (status);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE membership_requests ENABLE ROW LEVEL SECURITY;

-- Convex fields: username, deviceId, createdAt, lastActiveAt, isBlocked, failedAttempts, lastFailedAt
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    convex_created_at text NOT NULL, -- doc field createdAt
    username text NOT NULL,
    device_id text NOT NULL,
    last_active_at text NULL,
    is_blocked boolean NULL,
    failed_attempts double precision NULL,
    last_failed_at text NULL
);

CREATE INDEX users_by_username ON users (username);
CREATE INDEX users_by_device_id ON users (device_id);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Convex fields: deviceId, pushToken, lastActiveAt
CREATE TABLE devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    device_id text NOT NULL,
    push_token text NULL,
    last_active_at text NOT NULL
);

CREATE INDEX devices_by_device_id ON devices (device_id);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- Convex fields: deviceId, title, body, data, createdAt, readBy
CREATE TABLE alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    convex_created_at text NOT NULL, -- doc field createdAt
    device_id text NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb NULL,
    read_by jsonb NULL
);

CREATE INDEX alerts_by_device_id ON alerts (device_id);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Convex fields: deviceId, productId, tier, purchaseToken, transactionId, status, receiptData, verifiedAt, expiresAt, createdAt, updatedAt
CREATE TABLE purchases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    convex_created_at text NOT NULL, -- doc field createdAt
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

CREATE INDEX purchases_by_device_id ON purchases (device_id);
CREATE INDEX purchases_by_purchase_token ON purchases (purchase_token);
CREATE INDEX purchases_by_status ON purchases (status);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- Convex fields: date, analysisType, status, freeRecommendations, paidRecommendations, vipRecommendations, verificationNotes, removedMatches, confidenceAdjustment, generatedAt, verifiedAt, approvedAt, approvedBy, model, createdAt, updatedAt
CREATE TABLE analysis_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    convex_id text NOT NULL UNIQUE, -- old Convex _id (import mapping)
    created_at timestamptz NOT NULL DEFAULT now(), -- Convex _creationTime
    convex_created_at text NOT NULL, -- doc field createdAt
    "date" text NOT NULL,
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

CREATE INDEX analysis_results_by_date ON analysis_results ("date");
CREATE INDEX analysis_results_by_status ON analysis_results (status);
CREATE INDEX analysis_results_by_analysis_type ON analysis_results (analysis_type);

-- Policies come later; everything is denied by default while RLS is on.
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
