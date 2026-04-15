-- Add feed_mode column to space_channels for curated vs all-members music channels
ALTER TABLE app.space_channels ADD COLUMN IF NOT EXISTS feed_mode TEXT NOT NULL DEFAULT 'all';
