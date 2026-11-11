-- Channel subfolders become first-class categories (docs/CHANNEL_LAYOUT.md).
--
-- Before: `space_channels.category_id` was free text. The typed name was both
-- the id and the header, so a category could not be renamed, reordered, kept
-- empty or reliably reused ("Dev" and "dev" were two folders).
--
-- After: categories are rows with a stable id, a name and a position. Existing
-- strings become the ids (only case/whitespace variants are rewritten), so
-- clients that still render `categoryId` keep showing the same header. Channel
-- `position` stays a single space-wide order, renumbered canonically
-- (uncategorized first, then categories in order), so clients that sort by
-- position see the same order the new layout shows.
--
-- Idempotent: the test harness truncates app.schema_migrations between files
-- and replays every migration (older seed files included) on the same DB.

CREATE TABLE IF NOT EXISTS app.space_channel_categories (
  space_id   TEXT NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (space_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_space_channel_category_name
  ON app.space_channel_categories (space_id, lower(name));

-- Bumped by every channel/category mutation; the layout PUT's optimistic lock.
ALTER TABLE app.spaces ADD COLUMN IF NOT EXISTS channel_layout_rev INTEGER NOT NULL DEFAULT 0;

-- true = this channel's overrides are a copy of its category's and follow it.
ALTER TABLE app.space_channels ADD COLUMN IF NOT EXISTS permissions_synced BOOLEAN NOT NULL DEFAULT false;

-- ── Backfill categories from the free-text column ─────────────────────────

UPDATE app.space_channels
   SET category_id = NULL
 WHERE category_id IS NOT NULL AND btrim(category_id) = '';

-- One category per (space, case-insensitive trimmed string). Its id and name
-- are the trimmed string as written on the lowest-position channel.
WITH variants AS (
  SELECT space_id,
         lower(btrim(category_id)) AS k,
         btrim(category_id)        AS canon,
         position,
         row_number() OVER (PARTITION BY space_id, lower(btrim(category_id)) ORDER BY position, id) AS rn
    FROM app.space_channels
   WHERE category_id IS NOT NULL
), canon AS (
  SELECT v.space_id, v.k, v.canon,
         (SELECT min(position) FROM variants w WHERE w.space_id = v.space_id AND w.k = v.k) AS first_pos
    FROM variants v
   WHERE v.rn = 1
)
INSERT INTO app.space_channel_categories (space_id, id, name, position)
SELECT space_id, canon, canon,
       (row_number() OVER (PARTITION BY space_id ORDER BY first_pos, k)) - 1
  FROM canon
ON CONFLICT DO NOTHING;

-- Point every variant at its category's id (no-op for already-canonical rows).
UPDATE app.space_channels c
   SET category_id = cat.id
  FROM app.space_channel_categories cat
 WHERE c.category_id IS NOT NULL
   AND cat.space_id = c.space_id
   AND lower(cat.name) = lower(btrim(c.category_id))
   AND c.category_id IS DISTINCT FROM cat.id;

-- Categorized channels without their own overrides follow their category.
UPDATE app.space_channels c
   SET permissions_synced = true
 WHERE c.category_id IS NOT NULL
   AND c.permissions_synced = false
   AND NOT EXISTS (SELECT 1 FROM app.channel_overrides o WHERE o.channel_id = c.id);

-- Any writer that still stores a category *string* — an older backend after a
-- rollback, the pre-0039 seed migrations replayed by the test harness, manual
-- SQL — gets it resolved here the way the API resolves it: an existing id,
-- else an existing name (ignoring case and surrounding spaces), else a new
-- category named after it. So category_id always names a real category of the
-- same space, and nothing written the old way fails the FK below.
CREATE OR REPLACE FUNCTION app.space_channels_resolve_category() RETURNS trigger AS $fn$
DECLARE
  found_id TEXT;
  wanted   TEXT;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO found_id FROM app.space_channel_categories
   WHERE space_id = NEW.space_id AND id = NEW.category_id;
  IF FOUND THEN
    RETURN NEW;
  END IF;
  wanted := btrim(NEW.category_id);
  IF wanted = '' THEN
    NEW.category_id := NULL;
    RETURN NEW;
  END IF;
  SELECT id INTO found_id FROM app.space_channel_categories
   WHERE space_id = NEW.space_id AND lower(name) = lower(wanted)
   LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO app.space_channel_categories (space_id, id, name, position)
    VALUES (
      NEW.space_id, wanted, wanted,
      COALESCE((SELECT max(position) + 1 FROM app.space_channel_categories WHERE space_id = NEW.space_id), 0)
    )
    ON CONFLICT DO NOTHING;
    SELECT id INTO found_id FROM app.space_channel_categories
     WHERE space_id = NEW.space_id AND (id = wanted OR lower(name) = lower(wanted))
     LIMIT 1;
  END IF;
  NEW.category_id := found_id;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_space_channels_resolve_category
  BEFORE INSERT OR UPDATE OF category_id ON app.space_channels
  FOR EACH ROW EXECUTE FUNCTION app.space_channels_resolve_category();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'space_channels_category_fk') THEN
    ALTER TABLE app.space_channels
      ADD CONSTRAINT space_channels_category_fk
      FOREIGN KEY (space_id, category_id)
      REFERENCES app.space_channel_categories (space_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_space_channels_category
  ON app.space_channels (space_id, category_id);

-- ── channel_overrides: no more orphans ────────────────────────────────────
-- Channel deletes never removed their overrides (the voice temp-channel sweep
-- deleted rows directly too). Drop the orphans and let the database cascade.

DELETE FROM app.channel_overrides o
 WHERE NOT EXISTS (SELECT 1 FROM app.space_channels c WHERE c.id = o.channel_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channel_overrides_channel_fk') THEN
    ALTER TABLE app.channel_overrides
      ADD CONSTRAINT channel_overrides_channel_fk
      FOREIGN KEY (channel_id) REFERENCES app.space_channels (id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── Category permission templates ─────────────────────────────────────────
-- Copied onto the category's synced channels (channel_overrides stays the
-- only table permission checks read, here and in the relay).

CREATE TABLE IF NOT EXISTS app.category_overrides (
  role_id     TEXT NOT NULL,
  space_id    TEXT NOT NULL,
  category_id TEXT NOT NULL,
  permission  TEXT NOT NULL,
  effect      TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  PRIMARY KEY (role_id, category_id, permission),
  CONSTRAINT category_overrides_role_in_space_fk
    FOREIGN KEY (role_id, space_id) REFERENCES app.space_roles (id, space_id) ON DELETE CASCADE,
  CONSTRAINT category_overrides_category_fk
    FOREIGN KEY (space_id, category_id) REFERENCES app.space_channel_categories (space_id, id) ON DELETE CASCADE
);

-- ── Canonical channel order ───────────────────────────────────────────────

WITH ordered AS (
  SELECT c.id,
         (row_number() OVER (
            PARTITION BY c.space_id
            ORDER BY (c.category_id IS NOT NULL), cat.position, c.position, c.id
         )) - 1 AS rn
    FROM app.space_channels c
    LEFT JOIN app.space_channel_categories cat
      ON cat.space_id = c.space_id AND cat.id = c.category_id
)
UPDATE app.space_channels c
   SET position = o.rn
  FROM ordered o
 WHERE o.id = c.id AND c.position IS DISTINCT FROM o.rn;
