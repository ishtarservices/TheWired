-- Add mode column to spaces table
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'read-write';
