CREATE TABLE IF NOT EXISTS app.music_revisions (
  id TEXT PRIMARY KEY,
  addressable_id TEXT NOT NULL,
  kind INTEGER NOT NULL,
  pubkey TEXT NOT NULL,
  version INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_json JSONB NOT NULL,
  summary TEXT,
  diff_json JSONB,
  created_at BIGINT NOT NULL,
  UNIQUE (addressable_id, version)
);

CREATE INDEX IF NOT EXISTS idx_music_revisions_addressable ON app.music_revisions (addressable_id, version);
