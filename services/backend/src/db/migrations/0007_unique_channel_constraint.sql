-- Deduplicate any existing duplicate channels before adding constraint.
-- Keeps the row with the lowest position (or earliest created_at as tiebreak).
DELETE FROM app.space_channels
WHERE id NOT IN (
  SELECT DISTINCT ON (space_id, type, label) id
  FROM app.space_channels
  ORDER BY space_id, type, label, position ASC, created_at ASC
);

-- Prevent race-condition duplicates from concurrent seedDefaultChannels calls
CREATE UNIQUE INDEX IF NOT EXISTS uq_space_channel_type_label
  ON app.space_channels(space_id, type, label);
