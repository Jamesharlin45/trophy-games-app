-- supabase/access_revoke_expiry.sql
--
-- Grant revocation tracking + expiry marking for access management:
--   - access_tokens.revoked_at — set when an admin removes access (or when
--     the cron marks an expired grant). NULL = not revoked.
--   - membership_requests.revoked_at — set when an admin removes access from
--     an approved request (the status column stays 'approved' because the
--     CHECK constraint only allows pending|approved|rejected).
--
-- Run this once in the Supabase SQL Editor (paste and run). Not run by the repo.

ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz NULL;

ALTER TABLE membership_requests ADD COLUMN IF NOT EXISTS revoked_at timestamptz NULL;
