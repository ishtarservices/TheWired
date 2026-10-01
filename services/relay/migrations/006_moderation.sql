-- Operator moderation (App Store 1.2): suspended accounts + removed events.
--
-- Written by the backend's admin report actions (services/backend
-- reportService / moderationActions); read by the relay's write path
-- (src/db/moderation.rs) before any event is stored.
--
-- suspended_pubkeys: `suspend_pubkey`. The relay refuses the account's writes
--                    (kinds 5 and 62 excepted). Lifting sets lifted_at; the
--                    row stays as the record.
-- tombstones:        `remove_event` / `remove_music`. The relay refuses to
--                    store the id again. `event` keeps a copy of the removed
--                    event so a wrong removal can be restored and the content
--                    preserved for an escalation; blobs are not kept.
--
-- Additive + idempotent: an older binary ignores both tables. The backend
-- test suite applies this file too (test/helpers/relayEvents.ts).

CREATE SCHEMA IF NOT EXISTS relay;

CREATE TABLE IF NOT EXISTS relay.suspended_pubkeys (
    pubkey       TEXT PRIMARY KEY,
    reason       TEXT,
    report_id    TEXT,
    suspended_by TEXT NOT NULL,
    suspended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lifted_at    TIMESTAMPTZ,
    lifted_by    TEXT
);

CREATE TABLE IF NOT EXISTS relay.tombstones (
    event_id    TEXT PRIMARY KEY,
    pubkey      TEXT NOT NULL,
    kind        INTEGER NOT NULL,
    event       JSONB,
    reason      TEXT,
    report_id   TEXT,
    removed_by  TEXT NOT NULL,
    removed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    restored_at TIMESTAMPTZ,
    restored_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tombstones_pubkey ON relay.tombstones (pubkey);
