-- Every NIP-42 AUTH and every membership-gated REQ on the relay resolves
-- "which spaces is this pubkey in" (app.space_members WHERE pubkey = $1).
-- The primary key is (space_id, pubkey), so that lookup was a sequential scan.
--
-- Single statement on purpose: CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block, and a multi-statement migration file is sent as one
-- implicit transaction by the runner.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_space_members_pubkey ON app.space_members (pubkey);
