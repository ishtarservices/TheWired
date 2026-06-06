-- Cache the kind:0 `lud06` field (bech32-encoded LNURL-pay, the older NIP-57
-- form). Some clients publish lud06 instead of lud16; without this column the
-- L3 profile cache would resolve a stranger's profile (with a real created_at)
-- and skip the relay fetch, silently dropping lud06 — so they'd show up as
-- un-zappable. Nullable; existing rows keep working.

ALTER TABLE app.cached_profiles
  ADD COLUMN IF NOT EXISTS lud06 TEXT;
