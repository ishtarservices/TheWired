import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { buildMusicSearchDoc } from "../lib/musicSearchDoc.js";
import { escapeMsFilter } from "../lib/meiliFilter.js";

/**
 * Platform suspensions (`suspend_pubkey`, App Store 1.2) as the backend sees
 * them. The relay refuses a suspended account's writes on its own
 * (`relay.suspended_pubkeys`, relay migration 006); this module hides the
 * account from API responses: search, people, music browse, discovery,
 * trending, profiles and share pages. Events stay in relay.events and stay
 * readable over the relay — the owner chose API-only hiding — so lifting a
 * suspension restores everything by re-indexing.
 *
 * Reads go through a short in-process cache so the hot paths never add a
 * query, and fail OPEN to "nobody is suspended" (logged) — a missing relay
 * table during a deploy must not take search down.
 */

const CACHE_TTL_MS = 30_000;
/** Kinds the ingester puts in the `events` search index (ingestHandlers SEARCHABLE_KINDS). */
const SEARCHABLE_KINDS = [1, 9, 22, 30023, 34236, 30119];
const REINDEX_LIMIT = 5000;

let cache: { set: Set<string>; at: number } | null = null;
let warned = false;

async function load(): Promise<Set<string>> {
  try {
    const rows = (await db.execute(
      sql`SELECT pubkey FROM relay.suspended_pubkeys WHERE lifted_at IS NULL`,
    )) as unknown as Array<{ pubkey: string }>;
    warned = false;
    return new Set(rows.map((r) => r.pubkey));
  } catch (err) {
    if (!warned) {
      console.warn("[suspensions] could not read relay.suspended_pubkeys:", (err as Error).message);
      warned = true;
    }
    return new Set();
  }
}

export const suspensionService = {
  /** Currently suspended pubkeys (cached ≤ 30 s). */
  async suspendedSet(): Promise<Set<string>> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.set;
    const set = await load();
    cache = { set, at: Date.now() };
    return set;
  },

  async isSuspended(pubkey: string): Promise<boolean> {
    return (await this.suspendedSet()).has(pubkey);
  },

  /** Drop items authored by a suspended account. No query when nobody is. */
  async withoutSuspended<T>(items: T[], pubkeyOf: (item: T) => string | undefined | null): Promise<T[]> {
    if (items.length === 0) return items;
    const set = await this.suspendedSet();
    if (set.size === 0) return items;
    return items.filter((item) => {
      const pk = pubkeyOf(item);
      return !pk || !set.has(pk);
    });
  },

  /** Forget the cached set (after a suspend / lift in this process). */
  invalidate(): void {
    cache = null;
  },

  /** Remove every search document authored by `pubkey` (suspension). */
  async purgeSearchDocs(pubkey: string): Promise<void> {
    const ms = getMeilisearchClient();
    const filter = `pubkey = "${escapeMsFilter(pubkey)}"`;
    for (const index of ["events", "tracks", "albums"]) {
      try {
        await ms.index(index).deleteDocuments({ filter });
      } catch (err) {
        console.error(`[suspensions] purge ${index} failed:`, (err as Error).message);
      }
    }
    try {
      await ms.index("profiles").deleteDocument(pubkey);
    } catch (err) {
      console.error("[suspensions] purge profile failed:", (err as Error).message);
    }
  },

  /** Put `pubkey`'s public content back in search (suspension lifted). */
  async reindexSearchDocs(pubkey: string): Promise<void> {
    const ms = getMeilisearchClient();
    const kinds = sql.join(SEARCHABLE_KINDS.map((k) => sql`${k}`), sql`, `);
    const rows = (await db.execute(
      sql`SELECT id, pubkey, created_at, kind, tags, content
          FROM relay.events
          WHERE pubkey = ${pubkey} AND (kind IN (${kinds}) OR kind IN (31683, 33123))
          ORDER BY created_at DESC
          LIMIT ${REINDEX_LIMIT}`,
    )) as unknown as Array<{
      id: string;
      pubkey: string;
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
    }>;

    const isPublic = (tags: string[][]) =>
      !tags.some((t) => (t[0] === "h" || t[0] === "visibility") && !!t[1]);
    const events = rows
      .filter((r) => SEARCHABLE_KINDS.includes(r.kind) && isPublic(r.tags))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        pubkey: r.pubkey,
        content: r.content,
        created_at: Number(r.created_at),
        tags: r.tags,
      }));
    const asEvent = (r: (typeof rows)[number]) => ({ ...r, created_at: Number(r.created_at) });
    const tracks = rows
      .filter((r) => r.kind === 31683 && isPublic(r.tags))
      .map((r) => buildMusicSearchDoc(asEvent(r), 31683));
    const albums = rows
      .filter((r) => r.kind === 33123 && isPublic(r.tags))
      .map((r) => buildMusicSearchDoc(asEvent(r), 33123));

    try {
      if (events.length) await ms.index("events").addDocuments(events);
      if (tracks.length) await ms.index("tracks").addDocuments(tracks);
      if (albums.length) await ms.index("albums").addDocuments(albums);
    } catch (err) {
      console.error("[suspensions] reindex failed:", (err as Error).message);
    }

    try {
      const [profile] = (await db.execute(
        sql`SELECT name, display_name, about, nip05, picture FROM app.cached_profiles WHERE pubkey = ${pubkey}`,
      )) as unknown as Array<{
        name: string | null;
        display_name: string | null;
        about: string | null;
        nip05: string | null;
        picture: string | null;
      }>;
      if (profile) {
        await ms.index("profiles").updateDocuments([
          {
            pubkey,
            name: profile.name,
            display_name: profile.display_name,
            about: profile.about,
            nip05: profile.nip05,
            picture: profile.picture,
            has_nip05: !!profile.nip05,
          },
        ]);
      }
    } catch (err) {
      console.error("[suspensions] profile reindex failed:", (err as Error).message);
    }
  },
};
