-- Space channels table
CREATE TABLE IF NOT EXISTS app.space_channels (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  category_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  admin_only BOOLEAN NOT NULL DEFAULT false,
  slow_mode_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_space_channels_space_id ON app.space_channels(space_id);
