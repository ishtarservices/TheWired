-- Add visibility column for access control filtering.
-- Extracted from event tags at insert time: "private", "unlisted", or NULL (public).
-- Combined with the existing h_tag column, this enables the relay to filter
-- protected events from unauthorized queries.
ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS visibility TEXT;

-- Index for efficient visibility filtering
CREATE INDEX IF NOT EXISTS idx_events_visibility ON relay.events (visibility) WHERE visibility IS NOT NULL;

-- Backfill visibility from existing event tags
UPDATE relay.events
SET visibility = (
    SELECT elem->>1
    FROM jsonb_array_elements(tags) elem
    WHERE elem->>0 = 'visibility'
    LIMIT 1
)
WHERE visibility IS NULL
AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(tags) elem
    WHERE elem->>0 = 'visibility'
);
