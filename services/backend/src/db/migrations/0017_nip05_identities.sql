-- NIP-05 identity mapping: username@thewired.app -> pubkey
CREATE TABLE IF NOT EXISTS app.nip05_identities (
  username TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nip05_pubkey ON app.nip05_identities (pubkey);
