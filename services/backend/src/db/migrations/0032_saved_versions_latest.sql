-- Saved-version update tracking (WIR-165).
--
-- `has_update` used to be set for EVERY ingested 31683/33123 event for the
-- address, with no comparison against the fan's saved version — and the music
-- backfill REQ re-ingests every event on each relay reconnect, so every saved
-- row was re-flagged forever. The ingester now compares versions and records
-- the newest event it saw, so the client can show (and acknowledge) a version
-- it hasn't received from a relay yet.
ALTER TABLE app.saved_album_versions
  ADD COLUMN IF NOT EXISTS latest_event_id TEXT,
  ADD COLUMN IF NOT EXISTS latest_created_at BIGINT;

-- The ingester updates by address (the PK leads with pubkey).
CREATE INDEX IF NOT EXISTS saved_album_versions_addr_idx
  ON app.saved_album_versions (addressable_id);

-- Every existing flag was set without a version comparison. Clear them; the
-- next backfill re-flags only rows whose saved version is genuinely older.
UPDATE app.saved_album_versions SET has_update = FALSE WHERE has_update = TRUE;
