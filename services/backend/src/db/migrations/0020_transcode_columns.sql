-- Transcoding pipeline state and derived HLS paths for music uploads.
-- `status` (active/deleted) stays intact — transcode_status is orthogonal.

ALTER TABLE app.music_uploads
  ADD COLUMN IF NOT EXISTS transcode_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS hls_master_path TEXT,
  ADD COLUMN IF NOT EXISTS loudness_i REAL,
  ADD COLUMN IF NOT EXISTS loudness_tp REAL,
  ADD COLUMN IF NOT EXISTS transcoded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transcode_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'music_uploads_transcode_status_chk'
  ) THEN
    ALTER TABLE app.music_uploads
      ADD CONSTRAINT music_uploads_transcode_status_chk
      CHECK (transcode_status IN ('pending','processing','ready','failed','skipped'));
  END IF;
END $$;

-- Partial index: only the hot set (work to do) is indexed.
CREATE INDEX IF NOT EXISTS idx_music_uploads_transcode_status
  ON app.music_uploads(transcode_status)
  WHERE transcode_status IN ('pending','processing');
