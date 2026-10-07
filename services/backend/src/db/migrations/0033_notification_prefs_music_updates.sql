-- "Music updates" push preference (WIR-165 leftover / WIR-171).
--
-- The ingester now enqueues a `music_update` push for every fan whose saved
-- version of a track/project was flagged by a newer event. Both clients already
-- show a "music updates" toggle (default on) that gated the in-app row only;
-- this column lets the same toggle gate the server push.
ALTER TABLE app.notification_preferences
  ADD COLUMN IF NOT EXISTS music_updates BOOLEAN NOT NULL DEFAULT true;
