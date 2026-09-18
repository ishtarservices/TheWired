-- Mobile push: device tokens, richer notification preferences, watched
-- authors, and queue columns for coalescing.
--
-- push_devices is keyed by TOKEN, not (pubkey, token): a token identifies one
-- physical install and can only belong to the account currently signed in on
-- it. POST /push/devices upserts on token and rebinds pubkey — the backstop
-- for a device that switched accounts without a clean logout.
--
-- notification_preferences grows per-type switches (replies, reactions, zaps,
-- releases, friend_requests), per-space modes (all | mentions | nothing) and
-- the subscribed authors list; watched_by is its inverted index so the
-- ingester can fan a release out to its watchers in one lookup.

CREATE TABLE IF NOT EXISTS app.push_devices (
    id           TEXT PRIMARY KEY,
    pubkey       TEXT NOT NULL,
    provider     TEXT NOT NULL CHECK (provider IN ('expo', 'apns', 'fcm')),
    token        TEXT NOT NULL UNIQUE,
    platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    app_version  TEXT,
    locale       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_devices_pubkey ON app.push_devices (pubkey);

ALTER TABLE app.notification_preferences
    ADD COLUMN IF NOT EXISTS replies         BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS reactions       BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS zaps            BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS releases        BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS friend_requests BOOLEAN NOT NULL DEFAULT TRUE,
    -- {spaceId: "all" | "mentions" | "nothing"}
    ADD COLUMN IF NOT EXISTS space_modes     JSONB   NOT NULL DEFAULT '{}'::jsonb,
    -- ["<hex pubkey>", …]
    ADD COLUMN IF NOT EXISTS watched_pubkeys JSONB   NOT NULL DEFAULT '[]'::jsonb,
    -- unix ms; NULL = off
    ADD COLUMN IF NOT EXISTS dnd_until       BIGINT;

CREATE TABLE IF NOT EXISTS app.watched_by (
    author_pubkey  TEXT NOT NULL,
    watcher_pubkey TEXT NOT NULL,
    PRIMARY KEY (author_pubkey, watcher_pubkey)
);

CREATE INDEX IF NOT EXISTS idx_watched_by_watcher ON app.watched_by (watcher_pubkey);

ALTER TABLE app.notification_queue
    ADD COLUMN IF NOT EXISTS collapse_key TEXT,
    ADD COLUMN IF NOT EXISTS url          TEXT,
    ADD COLUMN IF NOT EXISTS attempts     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notification_queue_pending
    ON app.notification_queue (created_at) WHERE sent = FALSE;
