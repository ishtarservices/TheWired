CREATE TABLE IF NOT EXISTS app.music_proposals (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  addressable_id TEXT NOT NULL,
  target_album TEXT NOT NULL,
  proposer_pubkey TEXT NOT NULL,
  owner_pubkey TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  changes JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  event_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  resolved_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_proposals_target ON app.music_proposals (target_album, status);
CREATE INDEX IF NOT EXISTS idx_proposals_owner ON app.music_proposals (owner_pubkey, status);
