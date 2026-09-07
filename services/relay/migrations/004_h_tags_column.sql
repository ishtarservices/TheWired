-- Multi-space events: mirror EVERY `["h", <id>]` tag into an indexed array
-- column (music kinds 31683/33123/30119/31686 may carry several).
--
-- Invariant (maintained by event_store.rs on every insert):
--   h_tag  = h_tags[1]              (the first h tag, unchanged for single-h events)
--   h_tag IS NULL  <=>  h_tags = '{}'
-- The scalar `h_tag` column stays: the backend's "is this event public?" checks
-- (`h_tag IS NULL`) and the embedded SQLite build keep reading it.

ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS h_tags TEXT[];

-- Backfill existing rows once, preserving tag order so h_tags[1] = h_tag.
-- New inserts set the column explicitly (non-NULL), so this is a cheap no-op
-- on subsequent boots.
UPDATE relay.events SET
    h_tags = COALESCE((
        SELECT array_agg(elem->>1 ORDER BY ord)
        FROM jsonb_array_elements(tags) WITH ORDINALITY AS t(elem, ord)
        WHERE elem->>0 = 'h' AND elem->>1 IS NOT NULL
    ), '{}')
WHERE h_tags IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_htags ON relay.events USING GIN (h_tags);
