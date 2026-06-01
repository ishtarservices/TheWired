-- Extract p/e tags into indexed array columns (RELAY_OPTIMIZATIONS §2).
-- Tag filters previously did full-array scans via jsonb_array_elements(); array
-- containment with a GIN index is 10-100x faster. Also the single biggest prep
-- for the embedded SQLite relay port, which has no JSONB tag-unnest path.

ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS p_tags TEXT[];
ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS e_tags TEXT[];

-- Backfill existing rows once. New inserts set these columns explicitly (so
-- they are non-NULL), making this UPDATE a cheap no-op on subsequent boots.
UPDATE relay.events SET
    p_tags = COALESCE((
        SELECT array_agg(elem->>1)
        FROM jsonb_array_elements(tags) elem
        WHERE elem->>0 = 'p' AND elem->>1 IS NOT NULL
    ), '{}'),
    e_tags = COALESCE((
        SELECT array_agg(elem->>1)
        FROM jsonb_array_elements(tags) elem
        WHERE elem->>0 = 'e' AND elem->>1 IS NOT NULL
    ), '{}')
WHERE p_tags IS NULL OR e_tags IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_ptags ON relay.events USING GIN (p_tags);
CREATE INDEX IF NOT EXISTS idx_events_etags ON relay.events USING GIN (e_tags);
