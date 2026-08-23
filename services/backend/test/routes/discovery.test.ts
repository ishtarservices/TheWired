import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../src/db/connection.js";
import { spaces, spaceTags } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";

/**
 * Route tests for the explore surfaces soot browses signed out. Every request
 * here is deliberately made WITHOUT an Authorization header — App Store
 * 5.1.1(v) requires the app to work before sign-in, so a regression to
 * requiring NIP-98 must fail the suite.
 */

let server: FastifyInstance;

beforeAll(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS relay`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS relay.events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      kind INTEGER NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]',
      content TEXT NOT NULL DEFAULT '',
      sig TEXT NOT NULL,
      d_tag TEXT,
      h_tag TEXT,
      visibility TEXT,
      p_tags TEXT[],
      e_tags TEXT[]
    )
  `);
  for (const col of ["h_tag TEXT", "d_tag TEXT", "visibility TEXT", "e_tags TEXT[]"]) {
    await db.execute(sql.raw(`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS ${col}`));
  }
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM relay.events`);
  // app.scenes is seeded by migration 0028 but TRUNCATEd by the global
  // beforeEach, so re-seed the rows these tests read.
  await db.execute(sql`
    INSERT INTO app.scenes (slug, label, description, genres, tags, position) VALUES
      ('club',       'Club',       'Dance floors', ARRAY['techno','house'], ARRAY['club','techno','rave'], 40),
      ('garage-diy', 'Garage / DIY','Basement rock', ARRAY['garage','punk'], ARRAY['diy','garage'], 30)
    ON CONFLICT (slug) DO NOTHING
  `);
});

let seq = 0;
function nextId(label: string): string {
  seq += 1;
  return `${label}${seq}`.padEnd(64, "0").slice(0, 64);
}

async function seedSpace(
  id: string,
  opts: { listed?: boolean; tags?: string[]; creator?: string; score?: number } = {},
) {
  await db.insert(spaces).values({
    id,
    hostRelay: "wss://relay.test.com",
    name: `Space ${id}`,
    listed: opts.listed ?? true,
    creatorPubkey: opts.creator,
    discoveryScore: opts.score ?? 0,
    createdAt: Math.floor(Date.now() / 1000),
  });
  for (const tag of opts.tags ?? []) {
    await db.insert(spaceTags).values({ id: nextId("tag"), spaceId: id, tag });
  }
}

async function seedMusicEvent(opts: {
  pubkey: string;
  kind: 31683 | 33123;
  hTag?: string | null;
  visibility?: string | null;
  createdAt?: number;
}): Promise<string> {
  const id = nextId("music");
  const tags: string[][] = [["d", id.slice(0, 8)], ["title", `Track ${id.slice(0, 6)}`]];
  if (opts.hTag) tags.push(["h", opts.hTag]);
  if (opts.visibility) tags.push(["visibility", opts.visibility]);

  await db.execute(sql`
    INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, h_tag, visibility)
    VALUES (${id}, ${opts.pubkey}, ${opts.createdAt ?? Math.floor(Date.now() / 1000)},
            ${opts.kind}, ${JSON.stringify(tags)}::jsonb, '', ${"0".repeat(128)},
            ${opts.hTag ?? null}, ${opts.visibility ?? null})
  `);
  return id;
}

/** Guest request — no Authorization header, no X-Auth-Pubkey. */
function guestGet(url: string) {
  return server.inject({ method: "GET", url });
}

describe("GET /discovery/scenes", () => {
  it("is readable by a signed-out guest", async () => {
    const res = await guestGet("/discovery/scenes");
    expect(res.statusCode).toBe(200);
    const slugs = res.json().data.map((s: { slug: string }) => s.slug);
    expect(slugs).toContain("club");
    expect(slugs).toContain("garage-diy");
  });

  it("returns the tag and genre mapping each scene resolves to", async () => {
    const res = await guestGet("/discovery/scenes");
    const club = res.json().data.find((s: { slug: string }) => s.slug === "club");
    expect(club.label).toBe("Club");
    expect(club.tags).toEqual(expect.arrayContaining(["club", "techno"]));
    expect(club.genres).toEqual(expect.arrayContaining(["techno", "house"]));
  });

  it("orders by position", async () => {
    const slugs = (await guestGet("/discovery/scenes")).json().data.map((s: { slug: string }) => s.slug);
    expect(slugs.indexOf("garage-diy")).toBeLessThan(slugs.indexOf("club"));
  });

  it("counts only listed spaces toward spaceCount", async () => {
    await seedSpace("club-listed", { tags: ["club"] });
    await seedSpace("club-hidden", { listed: false, tags: ["club"] });

    const res = await guestGet("/discovery/scenes");
    const club = res.json().data.find((s: { slug: string }) => s.slug === "club");
    expect(club.spaceCount).toBe(1);
  });
});

describe("GET /discovery/spaces?tag=", () => {
  beforeEach(async () => {
    await seedSpace("rave-room", { tags: ["rave"] });
    await seedSpace("techno-room", { tags: ["techno"] });
    await seedSpace("punk-room", { tags: ["diy"] });
  });

  it("still accepts a single tag", async () => {
    const res = await guestGet("/discovery/spaces?tag=techno");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((s: { id: string }) => s.id)).toEqual(["techno-room"]);
  });

  it("ORs a comma-separated list so one scene resolves in one request", async () => {
    const res = await guestGet("/discovery/spaces?tag=club,techno,rave");
    const ids = res.json().data.map((s: { id: string }) => s.id).sort();
    expect(ids).toEqual(["rave-room", "techno-room"]);
  });

  it("matches tags case-insensitively", async () => {
    const res = await guestGet("/discovery/spaces?tag=TECHNO,Rave");
    expect(res.json().data).toHaveLength(2);
  });

  it("ignores empty segments and duplicates", async () => {
    const res = await guestGet("/discovery/spaces?tag=techno,,techno,%20");
    expect(res.json().data.map((s: { id: string }) => s.id)).toEqual(["techno-room"]);
  });

  it("filters in SQL, so limit still returns a full page", async () => {
    // Five more tagged spaces; without SQL-side filtering a limit=2 page would
    // be filtered down post-hoc and come back short or empty.
    for (let i = 0; i < 5; i++) await seedSpace(`extra-${i}`, { tags: ["techno"] });

    const res = await guestGet("/discovery/spaces?tag=techno&limit=2");
    expect(res.json().data).toHaveLength(2);
  });

  it("returns an empty list for a tag nobody carries", async () => {
    const res = await guestGet("/discovery/spaces?tag=vaporwave");
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /discovery/spaces — zap columns", () => {
  it("carries zapCount24h and zapSats24h on every row", async () => {
    await seedSpace("scene-room", { tags: ["club"] });
    await db
      .update(spaces)
      .set({ zapCount24h: 4, zapSats24h: 9001 })
      .where(eq(spaces.id, "scene-room"));

    const [row] = (await guestGet("/discovery/spaces?sort=trending")).json().data;
    expect(row.zapCount24h).toBe(4);
    expect(Number(row.zapSats24h)).toBe(9001);
  });

  it("reports zeroes rather than omitting the fields for an unzapped space", async () => {
    await seedSpace("quiet-room");
    const [row] = (await guestGet("/discovery/spaces")).json().data;
    expect(row.zapCount24h).toBe(0);
    expect(Number(row.zapSats24h)).toBe(0);
  });
});

describe("GET /discovery/spaces/music", () => {
  it("is readable by a signed-out guest", async () => {
    const res = await guestGet("/discovery/spaces/music");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ tracks: [], albums: [] });
  });

  it("surfaces public music by a listed space's creator, annotated with the space", async () => {
    await seedSpace("scene-room", { creator: LUNA.pubkey });
    const trackId = await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683 });

    const res = await guestGet("/discovery/spaces/music");
    const { tracks } = res.json().data;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(trackId);
    expect(tracks[0].space).toMatchObject({ id: "scene-room", name: "Space scene-room" });
  });

  it("includes music by members, not just creators", async () => {
    await seedSpace("scene-room", { creator: LUNA.pubkey });
    await db.insert(spaceMembers).values({ spaceId: "scene-room", pubkey: MARCUS.pubkey });
    await seedMusicEvent({ pubkey: MARCUS.pubkey, kind: 31683 });

    const { tracks } = (await guestGet("/discovery/spaces/music")).json().data;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].pubkey).toBe(MARCUS.pubkey);
  });

  it("separates tracks from albums", async () => {
    await seedSpace("scene-room", { creator: LUNA.pubkey });
    await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683 });
    await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 33123 });

    const { tracks, albums } = (await guestGet("/discovery/spaces/music")).json().data;
    expect(tracks).toHaveLength(1);
    expect(albums).toHaveLength(1);
    expect(tracks[0].kind).toBe(31683);
    expect(albums[0].kind).toBe(33123);
  });

  it("never leaks space-exclusive (h-tagged) uploads to a guest", async () => {
    await seedSpace("scene-room", { creator: LUNA.pubkey });
    await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683, hTag: "scene-room" });

    const { tracks } = (await guestGet("/discovery/spaces/music")).json().data;
    expect(tracks).toEqual([]);
  });

  it("never leaks private or unlisted uploads", async () => {
    await seedSpace("scene-room", { creator: LUNA.pubkey });
    await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683, visibility: "private" });
    await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683, visibility: "unlisted" });

    const { tracks } = (await guestGet("/discovery/spaces/music")).json().data;
    expect(tracks).toEqual([]);
  });

  it("excludes authors with no listed space", async () => {
    await seedSpace("hidden-room", { listed: false, creator: SAGE.pubkey });
    await seedMusicEvent({ pubkey: SAGE.pubkey, kind: 31683 });

    const { tracks } = (await guestGet("/discovery/spaces/music")).json().data;
    expect(tracks).toEqual([]);
  });

  it("attributes an author to their highest-scoring listed space", async () => {
    await seedSpace("small-room", { creator: LUNA.pubkey, score: 5 });
    await seedSpace("big-room", { creator: LUNA.pubkey, score: 500 });
    await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683 });

    const { tracks } = (await guestGet("/discovery/spaces/music")).json().data;
    expect(tracks[0].space.id).toBe("big-room");
  });

  it("orders by recency and honours limit", async () => {
    await seedSpace("scene-room", { creator: LUNA.pubkey });
    const now = Math.floor(Date.now() / 1000);
    const old = await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683, createdAt: now - 9000 });
    const fresh = await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683, createdAt: now });

    const all = (await guestGet("/discovery/spaces/music?sort=recent")).json().data;
    expect(all.tracks.map((t: { id: string }) => t.id)).toEqual([fresh, old]);

    const capped = (await guestGet("/discovery/spaces/music?limit=1")).json().data;
    expect(capped.tracks.map((t: { id: string }) => t.id)).toEqual([fresh]);
  });

  it("falls back to recency when nothing is trending yet (cold start)", async () => {
    await seedSpace("scene-room", { creator: LUNA.pubkey });
    const now = Math.floor(Date.now() / 1000);
    const old = await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683, createdAt: now - 9000 });
    const fresh = await seedMusicEvent({ pubkey: LUNA.pubkey, kind: 31683, createdAt: now });

    const res = await guestGet("/discovery/spaces/music?sort=trending");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tracks.map((t: { id: string }) => t.id)).toEqual([fresh, old]);
  });

  it("rejects an unknown sort rather than silently ignoring it", async () => {
    const res = await guestGet("/discovery/spaces/music?sort=popular");
    expect(res.statusCode).toBe(400);
  });
});
