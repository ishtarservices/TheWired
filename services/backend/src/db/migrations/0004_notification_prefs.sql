-- Notification preferences per user
CREATE TABLE IF NOT EXISTS app.notification_preferences (
  pubkey TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  mentions BOOLEAN NOT NULL DEFAULT true,
  dms BOOLEAN NOT NULL DEFAULT true,
  new_followers BOOLEAN NOT NULL DEFAULT true,
  chat_messages BOOLEAN NOT NULL DEFAULT true,
  muted_spaces JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
