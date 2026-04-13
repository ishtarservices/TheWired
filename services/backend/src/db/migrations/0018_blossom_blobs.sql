-- Blossom content-addressed blob storage (BUD-01/02)
CREATE TABLE IF NOT EXISTS app.blobs (
    sha256 TEXT PRIMARY KEY,
    size BIGINT NOT NULL,
    type TEXT,
    uploaded BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS app.blob_owners (
    sha256 TEXT NOT NULL REFERENCES app.blobs(sha256) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    PRIMARY KEY (sha256, pubkey)
);

CREATE INDEX IF NOT EXISTS idx_blob_owners_pubkey ON app.blob_owners(pubkey);

-- Backfill existing music_uploads into blobs table
INSERT INTO app.blobs (sha256, size, type, uploaded)
SELECT DISTINCT ON (sha256) sha256, file_size, mime_type, EXTRACT(EPOCH FROM created_at)::bigint
FROM app.music_uploads
WHERE sha256 IS NOT NULL AND sha256 != ''
ON CONFLICT (sha256) DO NOTHING;

-- Backfill blob ownership
INSERT INTO app.blob_owners (sha256, pubkey)
SELECT DISTINCT sha256, pubkey
FROM app.music_uploads
WHERE sha256 IS NOT NULL AND sha256 != ''
ON CONFLICT (sha256, pubkey) DO NOTHING;
