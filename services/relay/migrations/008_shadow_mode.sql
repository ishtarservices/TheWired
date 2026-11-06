-- Operator moderation, tier two: a *shadowed* account. Its writes are still
-- accepted and stored (the author keeps seeing its own posts and gets a normal
-- OK), but nobody else is served them — stored queries, NIP-50 search and the
-- live broadcast all exclude the author unless the reader IS the author. A
-- plain suspension keeps refusing writes as before.
--
-- Additive + idempotent: an older binary reads every row as a suspension
-- (it never looks at `mode`), which is the safe direction. The backend test
-- suite applies this file too (test/helpers/relayEvents.ts).
ALTER TABLE relay.suspended_pubkeys
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'suspended';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'suspended_pubkeys_mode_check'
    ) THEN
        ALTER TABLE relay.suspended_pubkeys
            ADD CONSTRAINT suspended_pubkeys_mode_check CHECK (mode IN ('suspended', 'shadowed'));
    END IF;
END $$;
