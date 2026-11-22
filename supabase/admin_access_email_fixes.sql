-- supabase/admin_access_email_fixes.sql
--
-- Idempotent SQL for the admin / email / device-id fixes. Safe to re-run:
-- only CREATE ... IF NOT EXISTS and ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- No DROP statements. Run once in the Supabase SQL Editor.
--
-- The email_outbox table itself is defined in setup.sql; recreate it here only
-- if it is missing on an older project.

CREATE TABLE IF NOT EXISTS email_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    to_email text NOT NULL,
    subject text NOT NULL,
    body_text text NOT NULL,
    body_html text NULL,
    token text NOT NULL,
    purchase_id uuid NULL,
    request_id uuid NULL,
    send_after timestamptz NOT NULL,
    sent_at timestamptz NULL,
    cancelled_at timestamptz NULL,
    attempts integer NOT NULL DEFAULT 0,
    last_error text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS request_id uuid NULL;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS last_error text NULL;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS purchase_id uuid NULL;
CREATE INDEX IF NOT EXISTS email_outbox_by_token ON email_outbox (token);
CREATE INDEX IF NOT EXISTS email_outbox_by_request ON email_outbox (request_id);
CREATE INDEX IF NOT EXISTS email_outbox_by_send_after ON email_outbox (sent_at, send_after);

-- Token email recipient (exact address stored with the membership request).
ALTER TABLE membership_requests ADD COLUMN IF NOT EXISTS email text NULL;
ALTER TABLE membership_requests ADD COLUMN IF NOT EXISTS issued_token text NULL;
ALTER TABLE membership_requests ADD COLUMN IF NOT EXISTS revoked_at text NULL;

-- Grant lifecycle: "approved" is derived from a live token, not this flag.
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS revoked_at text NULL;
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS is_claimed boolean NOT NULL DEFAULT false;
ALTER TABLE access_tokens ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Purchase rows are never deleted by admin actions (payment record).
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS email text NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS updated_at text NULL;

-- Legacy device count (tokens, purchases, requests, users).
-- SELECT
--   (SELECT count(*) FROM access_tokens WHERE device_id LIKE 'com.khanblair.trophygames%') AS tokens,
--   (SELECT count(*) FROM purchases      WHERE device_id LIKE 'com.khanblair.trophygames%') AS purchases,
--   (SELECT count(*) FROM membership_requests WHERE device_id LIKE 'com.khanblair.trophygames%') AS requests,
--   (SELECT count(*) FROM users          WHERE device_id LIKE 'com.khanblair.trophygames%') AS users;
