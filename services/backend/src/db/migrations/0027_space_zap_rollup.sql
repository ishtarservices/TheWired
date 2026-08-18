-- Per-space 24h zap rollup, so discovery can rank spaces by what the room
-- actually funds rather than by activity alone.
--
-- Zaps are per-EVENT on Nostr (a kind:9735 receipt carries an `e` tag pointing
-- at the zapped event). These two columns hold the rollup of every zap landing
-- on an event whose `h` tag is this space, over a trailing 24h window. They are
-- recomputed by discoveryService.rollupSpaceZaps() on the discovery-score
-- interval — never incremented in-line — so a missed or replayed receipt can't
-- drift the total permanently.

ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS zap_count_24h INTEGER NOT NULL DEFAULT 0;
-- Sats, not msats. BIGINT because a single space could plausibly clear 2^31 sats.
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS zap_sats_24h BIGINT NOT NULL DEFAULT 0;
