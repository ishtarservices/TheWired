-- Kind-31685 proposals were indexed with a random nanoid primary key and
-- `ON CONFLICT DO NOTHING`, which never conflicts — so every time the ingester
-- re-delivered an event (reconnect, replay) it added another row. One listen
-- request in dev had 9 copies: 1 accepted, 8 still open in the owner's inbox.
--
-- 1. Keep one row per addressable id. A resolved copy wins over open ones (the
--    owner already acted on that event); otherwise the newest event.
DELETE FROM app.music_proposals p
USING (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY addressable_id
               ORDER BY (status <> 'open') DESC, created_at DESC, resolved_at DESC NULLS LAST, id
           ) AS rn
    FROM app.music_proposals
) ranked
WHERE p.id = ranked.id AND ranked.rn > 1;

-- 2. Listen requests (a `grant_access` change): mobile builds before this fix
--    minted a fresh d-tag per "ask again", so one requester could hold several
--    open rows for the same target. Keep the newest open one.
DELETE FROM app.music_proposals p
USING (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY proposer_pubkey, target_album
               ORDER BY created_at DESC, id
           ) AS rn
    FROM app.music_proposals
    WHERE status = 'open' AND changes @> '[{"type":"grant_access"}]'::jsonb
) ranked
WHERE p.id = ranked.id AND ranked.rn > 1;

-- 3. Open listen requests against a malformed target ref were never
--    actionable (the ingester did not validate the address).
DELETE FROM app.music_proposals
WHERE status = 'open'
  AND changes @> '[{"type":"grant_access"}]'::jsonb
  AND target_album !~ '^(31683|33123):[0-9a-f]{64}:.+$';

-- 4. One row per addressable event from now on; the indexer upserts on it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposals_addressable
    ON app.music_proposals (addressable_id);

-- 5. Per-requester lookups (open-request cap, decline cooldown).
CREATE INDEX IF NOT EXISTS idx_proposals_proposer
    ON app.music_proposals (proposer_pubkey, target_album, status);
