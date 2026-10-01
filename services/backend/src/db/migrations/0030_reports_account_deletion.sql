-- App Store submission: user reports (1.2), the platform moderation audit
-- trail, and account deletion (5.1.1(v)).
--
-- 1. app.moderation_audit_log has been in the drizzle schema (and written by
--    moderationService) since the space moderation routes landed, but never had
--    a migration, so every audit write failed silently. Created here, with
--    space_id NULLABLE: platform-level actions (report resolutions) have no
--    space. Idempotent whether or not some environment already has the table.
CREATE TABLE IF NOT EXISTS app.moderation_audit_log (
    id TEXT PRIMARY KEY,
    space_id TEXT REFERENCES app.spaces(id) ON DELETE CASCADE,
    actor_pubkey TEXT NOT NULL,
    action TEXT NOT NULL,
    target_pubkey TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app.moderation_audit_log ALTER COLUMN space_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_moderation_audit_space
    ON app.moderation_audit_log (space_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_audit_target
    ON app.moderation_audit_log (target_pubkey, created_at DESC);

-- 2. Reports. Two doors, one table: kind-1984 events ingested from the platform
--    relay (source 'nostr', report_event_id set) and POST /reports (source
--    'http', guests by IP hash). Ids only — never the reported text.
CREATE TABLE IF NOT EXISTS app.reports (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('nostr', 'http')),
    reporter_pubkey TEXT,
    reporter_ip_hash TEXT,
    target_type TEXT NOT NULL
        CHECK (target_type IN ('event', 'user', 'dm', 'voice', 'track', 'album')),
    target_event_id TEXT,
    target_coordinate TEXT,
    target_pubkey TEXT,
    target_kind INTEGER,
    -- voice room / space ids; never message content
    target_context JSONB,
    category TEXT NOT NULL CHECK (category IN
        ('spam', 'harassment', 'nudity', 'illegal', 'impersonation', 'malware', 'copyright', 'other')),
    note TEXT,
    report_event_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
    resolution TEXT,
    resolution_note TEXT,
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    triage JSONB
);

-- Dedupe on (reporter, target) while a report is open: a repeat returns the
-- existing row. A reporter identity is the pubkey, else the IP hash.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_open_reporter_target ON app.reports (
    (COALESCE(reporter_pubkey, 'ip:' || COALESCE(reporter_ip_hash, id))),
    target_type,
    (COALESCE(target_event_id, '')),
    (COALESCE(target_coordinate, '')),
    (COALESCE(target_pubkey, ''))
) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_reports_status_created
    ON app.reports (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target_pubkey
    ON app.reports (target_pubkey, created_at DESC) WHERE target_pubkey IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_target_event
    ON app.reports (target_event_id) WHERE target_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_reporter
    ON app.reports (reporter_pubkey) WHERE reporter_pubkey IS NOT NULL;

-- Retire app.spam_reports (created in 0001, referenced nowhere): carry any
-- rows over as open event reports, then drop it.
DO $$
BEGIN
    IF to_regclass('app.spam_reports') IS NOT NULL THEN
        INSERT INTO app.reports
            (id, source, reporter_pubkey, target_type, target_event_id, category, note, created_at)
        SELECT 'legacy-' || id, 'http', reporter_pubkey, 'event', event_id, 'spam',
               LEFT(reason, 500), COALESCE(created_at, NOW())
        FROM app.spam_reports
        ON CONFLICT DO NOTHING;
        DROP TABLE app.spam_reports;
    END IF;
END $$;

-- 3. Account deletion tombstone (DELETE /account, NIP-62).
--    One row per deleted pubkey: the proof of the request (the signed kind 62)
--    and the progress of an idempotent, re-runnable purge.
CREATE TABLE IF NOT EXISTS app.account_deletions (
    pubkey TEXT PRIMARY KEY,
    vanish_event_id TEXT NOT NULL,
    vanish_created_at BIGINT NOT NULL,
    vanish_event JSONB NOT NULL,
    owned_spaces TEXT CHECK (owned_spaces IN ('delete', 'orphan')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
    steps JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
