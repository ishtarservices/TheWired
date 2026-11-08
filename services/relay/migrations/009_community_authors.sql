-- Community authors (RELAY_FIREHOSE_POLICY=community): the accounts whose
-- notes an untargeted kind-1 REQ (the "firehose") returns. The relay's
-- refresh task (src/db/community.rs) recomputes the set every 30 s from the
-- backend's account tables and the relay lists stored here, keeps a copy in
-- memory for the live fan-out, and upserts it into this table so the stored
-- query stays a join (`EXISTS` against a small hashed table) instead of
-- shipping a multi-thousand-entry array with every REQ.
--
-- Additive + idempotent: an older binary never reads it. Nothing else writes
-- it; the backend test suite does not need it.

CREATE TABLE IF NOT EXISTS relay.community_authors (
    pubkey       TEXT PRIMARY KEY,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
