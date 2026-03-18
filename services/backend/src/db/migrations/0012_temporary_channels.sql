ALTER TABLE app.space_channels ADD COLUMN IF NOT EXISTS temporary boolean NOT NULL DEFAULT false;
