-- Profile cache coherence: store the kind:0 event's created_at (the version clock
-- for replaceable events) so upserts can reject stale events instead of blindly
-- overwriting, and store the remaining profile fields so the cache isn't lossy.
-- All columns are nullable; existing rows keep working (created_at NULL = unknown
-- version, treated as "needs revalidation from a relay" by the client).

ALTER TABLE app.cached_profiles
  ADD COLUMN IF NOT EXISTS created_at BIGINT,
  ADD COLUMN IF NOT EXISTS banner TEXT,
  ADD COLUMN IF NOT EXISTS lud16 TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;
