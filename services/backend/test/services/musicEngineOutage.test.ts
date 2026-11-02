/**
 * Music discovery must survive the search engine going away. Two contracts:
 *
 *  - The boot reindex (rebuildCounts) never blanks anything: it upserts docs
 *    instead of deleting the index first, prunes only docs Postgres no longer
 *    backs, and rebuilds the genre/tag counts from Postgres even when the
 *    engine is down.
 *  - Recent and plays browse fall back to relay.events when a search call
 *    fails, so Explore shows plain recency instead of a 500.
 *
 * The engine is an in-memory fake with a `down` switch. relay.events is shared
 * across test files and not truncated, so every row here uses a file-unique
 * slug prefix and genre, and assertions only look at this file's rows.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { musicService } from "../../src/services/musicService.js";
import { getRedis } from "../../src/lib/redis.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  insertRelayEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

const meili = vi.hoisted(() => {
  type Doc = Record<string, unknown> & { id: string };
  const indexes = new Map<string, Map<string, Doc>>();
  const docs = (name: string) => {
    if (!indexes.has(name)) indexes.set(name, new Map());
    return indexes.get(name)!;
  };
  const state = { down: false };
  const guard = () => {
    if (state.down) throw new Error("fetch failed: getaddrinfo ENOTFOUND meilisearch");
  };
  const deleteAllDocuments = vi.fn(async () => {
    guard();
    return { taskUid: 0 };
  });
  const index = (name: string) => ({
    addDocuments: async (batch: Doc[]) => {
      guard();
      batch.forEach((d) => docs(name).set(d.id, d));
      return { taskUid: 0 };
    },
    deleteDocuments: async (ids: string[]) => {
      guard();
      ids.forEach((id) => docs(name).delete(id));
      return { taskUid: 0 };
    },
    deleteAllDocuments,
    getDocuments: async ({ limit = 20, offset = 0 }: { limit?: number; offset?: number } = {}) => {
      guard();
      const all = [...docs(name).values()].map((d) => ({ id: d.id }));
      return { results: all.slice(offset, offset + limit), total: all.length, limit, offset };
    },
    search: async () => {
      guard();
      return { hits: [], estimatedTotalHits: 0 };
    },
  });
  return { docs, indexes, state, deleteAllDocuments, client: { index } };
});

vi.mock("../../src/lib/meilisearch.js", () => ({ getMeilisearchClient: () => meili.client }));

const PREFIX = "engout-";
const GENRE = "EngineOutageGenre";
const T0 = 1_800_000_000;
const redis = getRedis();

/** A release row with arbitrary extra tags (catalog:none, moved, …). */
async function insertTagged(
  kind: number,
  slug: string,
  extra: string[][],
  createdAt: number,
  pubkey = LUNA.pubkey,
) {
  const tags = [["d", PREFIX + slug], ["title", slug], ["genre", GENRE], ...extra];
  const id = createHash("sha256").update(JSON.stringify([kind, slug, extra, createdAt, pubkey])).digest("hex");
  await insertRelayEvent({
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content: "",
    sig: "0".repeat(128),
  });
  return id;
}

/** A listed public track in this file's genre. */
function listedTrack(slug: string, createdAt: number, pubkey = LUNA.pubkey) {
  return insertTagged(31683, slug, [], createdAt, pubkey);
}

beforeAll(async () => {
  await ensureRelayEventsTable();
});

beforeEach(() => {
  meili.indexes.clear();
  meili.state.down = false;
  meili.deleteAllDocuments.mockClear();
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(PREFIX);
});

describe("rebuildCounts (boot reindex)", () => {
  it("upserts in place: never deletes the index first, so search never reads empty", async () => {
    const id = await listedTrack("upsert", T0);
    meili.docs("tracks").set(id, { id, title: "old copy" });

    await musicService.rebuildCounts();

    expect(meili.deleteAllDocuments).not.toHaveBeenCalled();
    expect(meili.docs("tracks").get(id)?.title).toBe("upsert");
  });

  it("prunes a doc whose event no longer exists", async () => {
    const ghost = "f".repeat(64);
    meili.docs("tracks").set(ghost, { id: ghost });

    const result = await musicService.rebuildCounts();

    expect(meili.docs("tracks").has(ghost)).toBe(false);
    expect(result.pruned).toBeGreaterThanOrEqual(1);
  });

  it("prunes a doc whose event turned private", async () => {
    const id = await insertMusicEvent({
      kind: 31683,
      pubkey: LUNA.pubkey,
      slug: PREFIX + "private",
      visibility: "private",
    });
    meili.docs("tracks").set(id, { id });

    await musicService.rebuildCounts();

    expect(meili.docs("tracks").has(id)).toBe(false);
  });

  it("treats a missing index as nothing to prune", async () => {
    const original = meili.client.index;
    meili.client.index = (name: string) => ({
      ...original(name),
      getDocuments: async () => {
        throw Object.assign(new Error("Index `albums` not found."), { cause: { code: "index_not_found" } });
      },
    });
    try {
      await expect(musicService.rebuildCounts()).resolves.toMatchObject({ pruned: 0 });
    } finally {
      meili.client.index = original;
    }
  });

  it("rebuilds the counts from Postgres while the engine is down, then reports the failure", async () => {
    await listedTrack("counted", T0);
    meili.state.down = true;

    await expect(musicService.rebuildCounts()).rejects.toThrow("ENOTFOUND");

    expect(Number(await redis.zscore("music:genre_counts", GENRE))).toBeGreaterThanOrEqual(1);
  });

  it("does not prune anything when an upsert failed", async () => {
    const ghost = "e".repeat(64);
    meili.docs("tracks").set(ghost, { id: ghost });
    await listedTrack("partial", T0);
    // Fail the writes but keep listing/deleting available.
    const original = meili.client.index;
    meili.client.index = (name: string) => ({
      ...original(name),
      addDocuments: async () => {
        throw new Error("engine rejected batch");
      },
    });
    try {
      await expect(musicService.rebuildCounts()).rejects.toThrow("engine rejected batch");
    } finally {
      meili.client.index = original;
    }

    expect(meili.docs("tracks").has(ghost)).toBe(true);
  });
});

describe("browse falls back to Postgres when the engine is down", () => {
  beforeEach(() => {
    meili.state.down = true;
  });

  it("serves recent tracks newest first, listed only", async () => {
    const older = await listedTrack("recent-older", T0 + 1);
    const newer = await listedTrack("recent-newer", T0 + 10);
    const hidden = [
      await insertTagged(31683, "recent-unlisted", [["catalog", "none"]], T0 + 20),
      await insertTagged(31683, "recent-moved", [["moved", "31683:abc:new"]], T0 + 30),
      await insertTagged(31683, "recent-space", [["h", "somespace"]], T0 + 40),
      await insertTagged(31683, "recent-private", [["visibility", "private"]], T0 + 50),
    ];

    const result = await musicService.browse({ sort: "recent", genre: GENRE, limit: 50 });
    const ids = result.tracks.map((t) => t!.id);

    // Earlier tests in this file left other listed rows in this genre.
    expect(ids.filter((id) => id === older || id === newer)).toEqual([newer, older]);
    for (const id of hidden) expect(ids).not.toContain(id);
    expect(result.total).toBe(ids.length);
  });

  it("matches genre case-insensitively, like the engine", async () => {
    const id = await listedTrack("recent-case", T0);
    const result = await musicService.browse({ sort: "recent", genre: GENRE.toLowerCase(), limit: 10 });
    expect(result.tracks.map((t) => t!.id)).toContain(id);
  });

  it("ranks the recent pool by plays", async () => {
    const quiet = await listedTrack("plays-quiet", T0 + 10);
    const loud = await listedTrack("plays-loud", T0);
    await redis.set(`play_count:31683:${LUNA.pubkey}:${PREFIX}plays-loud`, "9");

    const result = await musicService.browse({ sort: "plays", genre: GENRE, limit: 10 });
    const order = result.tracks.map((t) => t!.id).filter((id) => id === quiet || id === loud);

    expect(order).toEqual([loud, quiet]);
  });

  it("serves recent albums", async () => {
    const album = await insertTagged(33123, "album-recent", [], T0);
    const result = await musicService.browseAlbums({ sort: "recent", genre: GENRE, limit: 10 });
    expect(result.albums.map((a) => (a as { id: string }).id)).toContain(album);
  });

  it("still hides a suspended author's tracks", async () => {
    const { suspensionService } = await import("../../src/services/suspensionService.js");
    const { db } = await import("../../src/db/connection.js");
    const { sql } = await import("drizzle-orm");
    const hidden = await listedTrack("suspended", T0, MARCUS.pubkey);
    await db.execute(sql`INSERT INTO relay.suspended_pubkeys (pubkey, suspended_by) VALUES (${MARCUS.pubkey}, 'admin')`);
    suspensionService.invalidate();
    try {
      const result = await musicService.browse({ sort: "recent", genre: GENRE, limit: 50 });
      expect(result.tracks.map((t) => t!.id)).not.toContain(hidden);
    } finally {
      await db.execute(sql`DELETE FROM relay.suspended_pubkeys WHERE pubkey = ${MARCUS.pubkey}`);
      suspensionService.invalidate();
    }
  });
});
