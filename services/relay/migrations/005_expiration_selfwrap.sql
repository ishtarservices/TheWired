-- NIP-40 expiration + NIP-17 self-wrap flag (docs/DM_WIRE_CONTRACT.md §7).
--
-- expires_at:     the event's `expiration` tag (unix seconds), NULL when absent.
--                 Expired rows are never served and are swept every 5 minutes.
-- self_published: a kind-1059 gift wrap published by a NIP-42-authenticated
--                 connection whose pubkey equals the wrap's `p` tag — the
--                 sender's own copy. The backend push planner skips these.
--
-- Additive + idempotent: an older binary ignores both columns.

ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS expires_at BIGINT;
ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS self_published BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_events_expires_at ON relay.events (expires_at)
    WHERE expires_at IS NOT NULL;
