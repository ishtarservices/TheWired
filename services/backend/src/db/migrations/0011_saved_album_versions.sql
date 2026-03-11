CREATE TABLE IF NOT EXISTS app.saved_album_versions (
  pubkey TEXT NOT NULL,
  addressable_id TEXT NOT NULL,
  saved_event_id TEXT NOT NULL,
  saved_created_at BIGINT NOT NULL,
  has_update BOOLEAN DEFAULT FALSE,
  saved_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (pubkey, addressable_id)
);
