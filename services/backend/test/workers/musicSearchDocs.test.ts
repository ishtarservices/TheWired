/**
 * One search doc and one genre/tag count per release address. The tracks and
 * albums indexes are keyed by event id, so every public republish of an
 * addressable release (an edit, a shared project's owner-set change, a
 * re-sign) used to leave the older version's doc in place. /search/music then
 * returned the release once per version, and each listed version counted its
 * genre and tags again.
 *
 * Meilisearch is an in-memory fake that applies writes at once and understands
 * the filter shapes the music code sends. Redis is ioredis-mock. Needs Postgres
 * `thewired_test` (saved-version flagging, revisions, relay.events).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { finalizeEvent } from "nostr-tools";
import { processEvent, type IngestContext, type NostrEvent } from "../../src/workers/ingestHandlers.js";
import { searchService } from "../../src/services/searchService.js";
import { getRedis } from "../../src/lib/redis.js";
import { ensureRelayEventsTable } from "../helpers/relayEvents.js";
import { LUNA } from "../helpers/testUsers.js";

const meili = vi.hoisted(() => {
  type Doc = Record<string, unknown>;
  const indexes = new Map<string, Map<string, Doc>>();
  const docs = (name: string) => {
    if (!indexes.has(name)) indexes.set(name, new Map());
    return indexes.get(name)!;
  };
  // `field = "value"` clauses and the listed-only clause, joined by AND.
  const matches = (doc: Doc, filter?: string) =>
    !filter ||
    filter.split(" AND ").every((clause) => {
      if (clause === "NOT unlisted = true") return doc.unlisted !== true;
      const m = clause.match(/^(\w+) = "(.*)"$/);
      if (!m) throw new Error(`fake meilisearch: unsupported filter clause ${clause}`);
      const value = doc[m[1]];
      return Array.isArray(value) ? value.includes(m[2]) : value === m[2];
    });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Like the real engine: writes are tasks applied later, in order, and a
  // search answers from what is applied so far. Writes land well after a
  // search returns, so two ingests of one release collide unless the code
  // orders them and waits for its own write.
  let queue: Promise<void> = Promise.resolve();
  let taskUid = 0;
  const tasks = new Map<number, Promise<void>>();
  const enqueue = (apply: () => void) => {
    queue = queue.then(() => sleep(50).then(apply));
    tasks.set(++taskUid, queue);
    return { taskUid };
  };
  const index = (name: string) => ({
    addDocuments: async (batch: Doc[]) =>
      enqueue(() => batch.forEach((d) => docs(name).set(d.id as string, d))),
    deleteDocuments: async (ids: string[]) => enqueue(() => ids.forEach((id) => docs(name).delete(id))),
    deleteDocument: async (id: string) => enqueue(() => docs(name).delete(id)),
    waitForTask: async (uid: number) => {
      await tasks.get(uid);
      return { status: "succeeded" };
    },
    search: async (_q: string, opts: { filter?: string; limit?: number } = {}) => {
      await sleep(10);
      const hits = [...docs(name).values()].filter((d) => matches(d, opts.filter)).slice(0, opts.limit ?? 20);
      return { hits, estimatedTotalHits: hits.length };
    },
  });
  /** Let every enqueued write land. */
  const drain = () => queue;
  return { indexes, docs, drain, client: { index } };
});

vi.mock("../../src/lib/meilisearch.js", () => ({ getMeilisearchClient: () => meili.client }));

const own: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
const redis = getRedis();
const T0 = 1_800_000_000;

function release(
  kind: 31683 | 33123,
  d: string,
  createdAt: number,
  opts: { genre?: string; extra?: string[][] } = {},
): NostrEvent {
  return finalizeEvent(
    {
      kind,
      created_at: createdAt,
      tags: [
        ["d", d],
        ["title", `${d} @${createdAt}`],
        ["genre", opts.genre ?? "house"],
        ["t", "deep"],
        ...(opts.extra ?? []),
      ],
      content: "",
    },
    LUNA.secretKey,
  ) as NostrEvent;
}

/** Ingest in order, then let the index catch up before asserting. */
async function ingest(...events: NostrEvent[]) {
  for (const e of events) await processEvent(e, own);
  await meili.drain();
}

const track = (d: string, createdAt: number, opts?: { genre?: string; extra?: string[][] }) =>
  release(31683, d, createdAt, opts);
const ids = (name: string) => [...meili.docs(name).keys()];
const genreCount = async (genre: string) => Number((await redis.zscore("music:genre_counts", genre)) ?? 0);
const tagCount = async (tag: string) => Number((await redis.zscore("music:tag_counts", tag)) ?? 0);
const searchTracks = async () =>
  (await searchService.searchMusic("", { type: "track" })) as Record<string, unknown>[];

beforeAll(async () => {
  await ensureRelayEventsTable();
});

beforeEach(async () => {
  meili.indexes.clear();
  await redis.del("music:genre_counts", "music:tag_counts", "music:counted_events");
});

describe("music ingest keeps one search doc per release address", () => {
  it("a public edit replaces the earlier version: one hit, one count", async () => {
    const v1 = track("edit", T0);
    const v2 = track("edit", T0 + 100);
    await ingest(v1, v2);

    expect(ids("tracks")).toEqual([v2.id]);
    expect((await searchTracks()).map((h) => h.id)).toEqual([v2.id]);
    expect(await genreCount("house")).toBe(1);
    expect(await tagCount("deep")).toBe(1);
    expect(await redis.smembers("music:counted_events")).toEqual([v2.id]);
  });

  it("moves the count when an edit changes the genre", async () => {
    await ingest(track("regenre", T0));
    await ingest(track("regenre", T0 + 100, { genre: "techno" }));

    expect(await genreCount("house")).toBe(0);
    expect(await genreCount("techno")).toBe(1);
    expect(await tagCount("deep")).toBe(1);
  });

  it("ignores an older version delivered after the newer one", async () => {
    const v1 = track("late", T0);
    const v2 = track("late", T0 + 100);
    await ingest(v2, v1);

    expect(ids("tracks")).toEqual([v2.id]);
    expect(await genreCount("house")).toBe(1);
  });

  it("leaves one doc when two versions are ingested at once", async () => {
    // processEvent is fire-and-forget per relay message, so versions overlap.
    const v1 = track("race", T0);
    const v2 = track("race", T0 + 100);
    await Promise.all([processEvent(v1, own), processEvent(v2, own)]);
    await meili.drain();

    expect(ids("tracks")).toEqual([v2.id]);
    expect(await genreCount("house")).toBe(1);
    expect(await tagCount("deep")).toBe(1);
  });

  it("re-ingesting the current version (a reconnect replay) counts it once", async () => {
    const v1 = track("replay", T0);
    await ingest(v1, v1);

    expect(ids("tracks")).toEqual([v1.id]);
    expect(await genreCount("house")).toBe(1);
  });

  it("keeps separate releases apart", async () => {
    await ingest(track("one", T0));
    await ingest(track("two", T0));

    expect(ids("tracks")).toHaveLength(2);
    expect(await genreCount("house")).toBe(2);
  });

  it("an edit to catalog:none keeps the doc (unlisted) but drops it from search and counts", async () => {
    await ingest(track("hide", T0));
    const v2 = track("hide", T0 + 100, { extra: [["catalog", "none"]] });
    await ingest(v2);

    expect(ids("tracks")).toEqual([v2.id]);
    expect(meili.docs("tracks").get(v2.id)?.unlisted).toBe(true);
    expect(await searchTracks()).toEqual([]);
    expect(await genreCount("house")).toBe(0);
  });

  it("privatizing still removes the public doc and its count", async () => {
    await ingest(track("private", T0));
    await ingest(track("private", T0 + 100, { extra: [["visibility", "private"]] }));

    expect(ids("tracks")).toEqual([]);
    expect(await genreCount("house")).toBe(0);
  });

  it("a shared project's moved stub removes the old doc and is never indexed itself", async () => {
    await ingest(track("rotated", T0));
    const target = `31683:${"b".repeat(64)}:rotated`;
    await ingest(track("rotated", T0 + 100, { extra: [["moved", target]] }));

    expect(ids("tracks")).toEqual([]);
    expect(await genreCount("house")).toBe(0);
    expect(await tagCount("deep")).toBe(0);
  });

  it("does the same for albums", async () => {
    const v1 = release(33123, "album", T0);
    const v2 = release(33123, "album", T0 + 100);
    await ingest(v1, v2);

    expect(ids("albums")).toEqual([v2.id]);
    expect(await genreCount("house")).toBe(1);
  });
});

describe("kind 5 deletion of a release", () => {
  it("does not uncount an unlisted track that was never counted", async () => {
    await ingest(track("listed", T0));
    const clip = track("clip", T0, { extra: [["catalog", "none"]] });
    await ingest(clip);
    expect(await genreCount("house")).toBe(1);

    const deletion = finalizeEvent(
      { kind: 5, created_at: T0 + 200, tags: [["a", `31683:${LUNA.pubkey}:clip`]], content: "" },
      LUNA.secretKey,
    ) as NostrEvent;
    await ingest(deletion);

    expect(ids("tracks")).not.toContain(clip.id);
    expect(await genreCount("house")).toBe(1);
  });
});

describe("searchMusic over an index that still holds older versions", () => {
  it("returns each release once, as its newest version", async () => {
    const addr = `31683:${LUNA.pubkey}:legacy`;
    const doc = (id: string, createdAt: number) => ({
      id,
      addressable_id: addr,
      pubkey: LUNA.pubkey,
      title: "Legacy",
      created_at: createdAt,
      unlisted: false,
    });
    const tracks = meili.docs("tracks");
    tracks.set("old", doc("old", T0));
    tracks.set("new", doc("new", T0 + 100));
    tracks.set("older", doc("older", T0 - 100));

    expect((await searchTracks()).map((h) => h.id)).toEqual(["new"]);
  });
});
