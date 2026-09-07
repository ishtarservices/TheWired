/**
 * Helpers for seeding relay.events rows in tests. Mirrors the Rust relay's
 * insert behavior (services/relay/src/db/event_store.rs): the d_tag, h_tag,
 * h_tags, and visibility COLUMNS are populated from the corresponding tags,
 * which is what the backend's gating queries key on. Invariant kept here as in
 * the relay: `h_tag = h_tags[1]`, and `h_tag IS NULL <=> h_tags = '{}'`.
 *
 * relay.events is NOT truncated between tests (only app.* is), so callers must
 * use file-unique slugs/shas and clean up via deleteRelayEvents in afterAll.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { config } from "../../src/config.js";

export async function ensureRelayEventsTable(): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS relay`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS relay.events (
      id TEXT PRIMARY KEY, pubkey TEXT NOT NULL, created_at BIGINT NOT NULL,
      kind INTEGER NOT NULL, tags JSONB NOT NULL DEFAULT '[]', content TEXT NOT NULL DEFAULT '',
      sig TEXT NOT NULL, d_tag TEXT, h_tag TEXT, h_tags TEXT[], visibility TEXT
    )`);
  await db.execute(sql`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS visibility TEXT`);
  await db.execute(sql`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS h_tag TEXT`);
  await db.execute(sql`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS h_tags TEXT[]`);
  await db.execute(sql`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS d_tag TEXT`);
}

export interface MusicEventOpts {
  kind: number;
  pubkey: string;
  slug: string;
  title?: string;
  artist?: string;
  imageUrl?: string;
  visibility?: "private" | "unlisted";
  /** Space id — becomes both the `h` tag and the h_tag column. */
  hTag?: string;
  /** Several space ids — one `h` tag each; h_tag = first, h_tags = all.
   *  Takes precedence over `hTag` when both are given. */
  hTags?: string[];
  /** Adds an imeta tag whose url embeds the sha and carries an `x` sub-tag. */
  imetaSha?: string;
  /** Full p tags, e.g. ["p", pk, "", "collaborator"]. */
  pTags?: string[][];
  /** Addressable refs for `a` tags (albums/playlists → child tracks). */
  aTags?: string[];
  createdAt?: number;
}

/** Insert a music event row; returns the event id. */
export async function insertMusicEvent(opts: MusicEventOpts): Promise<string> {
  const tags: string[][] = [
    ["d", opts.slug],
    ["title", opts.title ?? `T ${opts.slug}`],
    ["artist", opts.artist ?? "Test Artist"],
  ];
  if (opts.imageUrl) tags.push(["image", opts.imageUrl]);
  if (opts.visibility) tags.push(["visibility", opts.visibility]);
  const hTags = opts.hTags ?? (opts.hTag ? [opts.hTag] : []);
  for (const h of hTags) tags.push(["h", h]);
  if (opts.pTags) tags.push(...opts.pTags);
  if (opts.aTags) for (const ref of opts.aTags) tags.push(["a", ref]);
  if (opts.imetaSha) {
    tags.push([
      "imeta",
      `url ${config.publicUrl}/${opts.imetaSha}.mp3`,
      "m audio/mpeg",
      `x ${opts.imetaSha}`,
      "size 1024",
    ]);
  }

  // drizzle's sql tag flattens a JS array into separate params, so build the
  // text[] literal explicitly (same as ARRAY[...] in discoveryZaps.test.ts).
  const hTagsArray =
    hTags.length === 0
      ? sql`'{}'::text[]`
      : sql`ARRAY[${sql.join(hTags.map((h) => sql`${h}`), sql`, `)}]::text[]`;

  const createdAt = opts.createdAt ?? Math.floor(Date.now() / 1000);
  const id = createHash("sha256")
    .update(JSON.stringify([opts.pubkey, opts.kind, tags, createdAt]))
    .digest("hex");

  await db.execute(
    sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig, d_tag, h_tag, h_tags, visibility)
        VALUES (${id}, ${opts.pubkey}, ${opts.kind}, ${JSON.stringify(tags)}::jsonb, '',
                ${createdAt}, ${"0".repeat(128)}, ${opts.slug}, ${hTags[0] ?? null},
                ${hTagsArray}, ${opts.visibility ?? null})
        ON CONFLICT (id) DO NOTHING`,
  );
  return id;
}

/** Remove every relay.events row whose d_tag starts with the given prefix. */
export async function deleteRelayEventsBySlugPrefix(prefix: string): Promise<void> {
  await db.execute(sql`DELETE FROM relay.events WHERE d_tag LIKE ${prefix + "%"}`);
}
