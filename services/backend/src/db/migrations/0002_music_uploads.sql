-- Music uploads table for storing uploaded audio/cover files
CREATE TABLE IF NOT EXISTS app.music_uploads (
    id TEXT PRIMARY KEY,
    pubkey TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    url TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    duration BIGINT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_uploads_pubkey ON app.music_uploads(pubkey);
CREATE INDEX IF NOT EXISTS idx_music_uploads_sha256 ON app.music_uploads(sha256);
