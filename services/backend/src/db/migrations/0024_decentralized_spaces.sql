-- Decentralized Spaces (PACKAGES_DESIGN.md §6): space modes + per-relay
-- ingestion registry. Purely additive — existing spaces become 'platform' with
-- full ingestion so today's behavior is unchanged.

-- Governance / source-of-truth mode for the space.
--   platform      — backend-authoritative (default; today's spaces)
--   decentralized — backend owns metadata/channels/roles, creator-chosen host relay (A-lite)
--   nip29         — relay-authoritative NIP-29 group (metadata from relay events)
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS space_mode TEXT NOT NULL DEFAULT 'platform';

-- How much the backend ingests for this space's host relay.
--   none      — no backend ingestion (private/unlisted decentralized spaces)
--   discovery — index content for search/directory/analytics
--   full      — discovery + push notifications
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS ingestion_tier TEXT NOT NULL DEFAULT 'none';

-- True when the group was created in / imported from another app (not Wired-origin).
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS external_origin BOOLEAN NOT NULL DEFAULT FALSE;

-- Member count mirrored from a NIP-29 relay's kind:39002 (relay-authoritative
-- spaces). Kept separate from member_count so foreign 39002 data never affects
-- app.space_members (which the Rust relay gates on for platform/A-lite spaces).
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS mirrored_member_count INTEGER NOT NULL DEFAULT 0;

-- Existing spaces are backend-authoritative platform spaces, ingested in full
-- (they already get indexed today via the single-relay ingester).
UPDATE app.spaces SET space_mode = 'platform', ingestion_tier = 'full'
WHERE space_mode = 'platform';

CREATE INDEX IF NOT EXISTS idx_spaces_space_mode ON app.spaces(space_mode);
CREATE INDEX IF NOT EXISTS idx_spaces_ingestion_tier ON app.spaces(ingestion_tier)
  WHERE ingestion_tier <> 'none';

-- Per-(relay, space) ingestion registry. Separate from relay_directory (which is
-- a public browse catalog): this is the allowlist of relays the backend will
-- dial for ingestion, with per-pair approval + health. A space may be mirrored
-- on multiple relays under federation; host_relay stays the primary for clients.
CREATE TABLE IF NOT EXISTS app.space_relays (
    relay_url TEXT NOT NULL,
    space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected | disabled
    registered_by TEXT NOT NULL,                -- creator pubkey
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    last_event_at TIMESTAMPTZ,
    error_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (relay_url, space_id)
);
-- The ingestion manager groups desired connections by relay_url.
CREATE INDEX IF NOT EXISTS idx_space_relays_relay ON app.space_relays(relay_url);
CREATE INDEX IF NOT EXISTS idx_space_relays_status ON app.space_relays(status);
CREATE INDEX IF NOT EXISTS idx_space_relays_space ON app.space_relays(space_id);
