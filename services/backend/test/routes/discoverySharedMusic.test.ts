/**
 * GET /discovery/spaces/music?source=shares — the share-based "from spaces"
 * rail (WIR-171). A row exists only because a member put the release on a
 * listed space's music-channel shelf (kind-9 with `a` + `channel`), so
 * "via <space>" is literally true. The publicness gate stays on the release
 * itself. Guest-readable like the rest of explore.
 *
 * Harness TRUNCATEs app.* between tests; relay.events is cleared per test here.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceChannels } from "../../src/db/schema/channels.js";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { ensureRelayEventsTable, insertRelayEvent } from "../helpers/relayEvents.js";
import { SHARE_LOOKBACK_SEC } from "../../src/services/discoveryService.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";

let server: FastifyInstance;
let seq = 0;
const now = () => Math.floor(Date.now() / 1000);
const fakeId = (label: string) => `${label}${++seq}`.padEnd(64, "0").slice(0, 64);

beforeAll(async () => {
  await ensureRelayEventsTable();
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});
beforeEach(async () => {
  await db.execute(sql`DELETE FROM relay.events`);
});

async function seedSpace(id: string, opts: { listed?: boolean; musicChannel?: string; chatChannel?: string } = {}) {
  await db.insert(spaces).values({
    id,
    hostRelay: "wss://relay.test.com",
    name: `Space ${id}`,
    picture: `https://img.test/${id}.png`,
    listed: opts.listed ?? true,
    creatorPubkey: LUNA.pubkey,
    createdAt: now(),
  });
  if (opts.musicChannel) {
    await db.insert(spaceChannels).values({ id: opts.musicChannel, spaceId: id, type: "music", label: "music" });
  }
  if (opts.chatChannel) {
    await db.insert(spaceChannels).values({ id: opts.chatChannel, spaceId: id, type: "chat", label: "general" });
  }
}

async function seedRelease(opts: {
  pubkey: string;
  kind?: 31683 | 33123;
  slug: string;
  createdAt?: number;
  hTag?: string;
  visibility?: string;
  unlisted?: boolean;
}): Promise<{ id: string; addr: string }> {
  const kind = opts.kind ?? 31683;
  const tags: string[][] = [["d", opts.slug], ["title", `Track ${opts.slug}`]];
  if (opts.hTag) tags.push(["h", opts.hTag]);
  if (opts.visibility) tags.push(["visibility", opts.visibility]);
  if (opts.unlisted) tags.push(["catalog", "none"]);
  const id = fakeId("rel");
  await insertRelayEvent({
    id, pubkey: opts.pubkey, kind, tags, content: "", created_at: opts.createdAt ?? now(), sig: "0".repeat(128),
  });
  return { id, addr: `${kind}:${opts.pubkey}:${opts.slug}` };
}

async function seedShare(opts: {
  by: string;
  spaceId: string;
  channelId: string;
  addr: string;
  createdAt?: number;
}): Promise<string> {
  const id = fakeId("share");
  const kind = opts.addr.split(":")[0];
  await insertRelayEvent({
    id,
    pubkey: opts.by,
    kind: 9,
    tags: [["h", opts.spaceId], ["channel", opts.channelId], ["a", opts.addr], ["k", kind]],
    content: `nostr:naddr1fake\n\nturn it up`,
    created_at: opts.createdAt ?? now(),
    sig: "0".repeat(128),
  });
  return id;
}

const guestGet = (url: string) => server.inject({ method: "GET", url });
const shares = async (q = "") => (await guestGet(`/discovery/spaces/music?source=shares${q}`)).json().data;

describe("GET /discovery/spaces/music?source=shares", () => {
  it("is readable by a signed-out guest and empty when nothing was shared", async () => {
    const res = await guestGet("/discovery/spaces/music?source=shares");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ tracks: [], albums: [] });
  });

  it("surfaces a public release shared into a listed space's music channel, annotated with that space", async () => {
    await seedSpace("room-a", { musicChannel: "room-a-music" });
    const rel = await seedRelease({ pubkey: SAGE.pubkey, slug: "one" });
    const at = now() - 60;
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "room-a-music", addr: rel.addr, createdAt: at });

    const { tracks, albums } = await shares();
    expect(albums).toEqual([]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      id: rel.id,
      pubkey: SAGE.pubkey,
      space: { id: "room-a", name: "Space room-a", picture: "https://img.test/room-a.png" },
      sharedAt: at,
      sharedBy: MARCUS.pubkey,
      shareCount: 1,
    });
  });

  it("separates tracks from projects and serves the newest stored version of each", async () => {
    await seedSpace("room-a", { musicChannel: "room-a-music" });
    const old = await seedRelease({ pubkey: SAGE.pubkey, slug: "ep", kind: 33123, createdAt: now() - 500 });
    const fresh = await seedRelease({ pubkey: SAGE.pubkey, slug: "ep", kind: 33123, createdAt: now() - 10 });
    expect(old.addr).toBe(fresh.addr);
    const track = await seedRelease({ pubkey: SAGE.pubkey, slug: "t" });
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "room-a-music", addr: fresh.addr });
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "room-a-music", addr: track.addr });

    const { tracks, albums } = await shares();
    expect(albums.map((a: { id: string }) => a.id)).toEqual([fresh.id]);
    expect(tracks.map((t: { id: string }) => t.id)).toEqual([track.id]);
  });

  it("ranks by share recency and collapses a release shared into several spaces to its newest share, counting the spaces", async () => {
    await seedSpace("room-a", { musicChannel: "a-music" });
    await seedSpace("room-b", { musicChannel: "b-music" });
    const first = await seedRelease({ pubkey: SAGE.pubkey, slug: "first" });
    const second = await seedRelease({ pubkey: SAGE.pubkey, slug: "second" });
    const t = now();
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: first.addr, createdAt: t - 300 });
    await seedShare({ by: LUNA.pubkey, spaceId: "room-b", channelId: "b-music", addr: first.addr, createdAt: t - 100 });
    // Shared twice into the same space: counts once.
    await seedShare({ by: LUNA.pubkey, spaceId: "room-b", channelId: "b-music", addr: first.addr, createdAt: t - 90 });
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: second.addr, createdAt: t - 200 });

    const { tracks } = await shares();
    expect(tracks.map((r: { id: string }) => r.id)).toEqual([first.id, second.id]);
    expect(tracks[0]).toMatchObject({ space: { id: "room-b" }, sharedBy: LUNA.pubkey, sharedAt: t - 90, shareCount: 2 });
    expect(tracks[1]).toMatchObject({ space: { id: "room-a" }, shareCount: 1 });
  });

  it("ignores shares into a non-music channel, an unlisted space, or with no channel tag", async () => {
    await seedSpace("room-a", { musicChannel: "a-music", chatChannel: "a-chat" });
    await seedSpace("hidden", { listed: false, musicChannel: "hidden-music" });
    const r1 = await seedRelease({ pubkey: SAGE.pubkey, slug: "r1" });
    const r2 = await seedRelease({ pubkey: SAGE.pubkey, slug: "r2" });
    const r3 = await seedRelease({ pubkey: SAGE.pubkey, slug: "r3" });
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-chat", addr: r1.addr });
    await seedShare({ by: MARCUS.pubkey, spaceId: "hidden", channelId: "hidden-music", addr: r2.addr });
    await insertRelayEvent({
      id: fakeId("bare"), pubkey: MARCUS.pubkey, kind: 9, content: "", created_at: now(), sig: "0".repeat(128),
      tags: [["h", "room-a"], ["a", r3.addr]],
    });

    expect((await shares()).tracks).toEqual([]);
  });

  it("never surfaces a space-exclusive, private, unlisted or catalog:none release, wherever it was shared", async () => {
    await seedSpace("room-a", { musicChannel: "a-music" });
    const gated = [
      await seedRelease({ pubkey: SAGE.pubkey, slug: "h", hTag: "room-a" }),
      await seedRelease({ pubkey: SAGE.pubkey, slug: "priv", visibility: "private" }),
      await seedRelease({ pubkey: SAGE.pubkey, slug: "unl", visibility: "unlisted" }),
      await seedRelease({ pubkey: SAGE.pubkey, slug: "clip", unlisted: true }),
    ];
    for (const g of gated) {
      await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: g.addr });
    }
    expect((await shares()).tracks).toEqual([]);
  });

  it("drops a release once its newest version went private, even though an older public version is stored", async () => {
    await seedSpace("room-a", { musicChannel: "a-music" });
    await seedRelease({ pubkey: SAGE.pubkey, slug: "flip", createdAt: now() - 500 });
    const flipped = await seedRelease({ pubkey: SAGE.pubkey, slug: "flip", visibility: "private", createdAt: now() - 10 });
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: flipped.addr });

    expect((await shares()).tracks).toEqual([]);
  });

  it("ignores shares older than the lookback window and a dangling share of an unknown release", async () => {
    await seedSpace("room-a", { musicChannel: "a-music" });
    const rel = await seedRelease({ pubkey: SAGE.pubkey, slug: "stale" });
    await seedShare({
      by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: rel.addr,
      createdAt: now() - SHARE_LOOKBACK_SEC - 60,
    });
    await seedShare({
      by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: `31683:${SAGE.pubkey}:never-published`,
    });
    expect((await shares()).tracks).toEqual([]);
  });

  it("honours limit", async () => {
    await seedSpace("room-a", { musicChannel: "a-music" });
    const t = now();
    for (let i = 0; i < 3; i++) {
      const rel = await seedRelease({ pubkey: SAGE.pubkey, slug: `lim${i}` });
      await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: rel.addr, createdAt: t - i });
    }
    expect((await shares("&limit=2")).tracks).toHaveLength(2);
  });

  it("the default (members) source is untouched: no share fields, author-join rows only", async () => {
    await seedSpace("room-a", { musicChannel: "a-music" });
    // SAGE is in no listed space; the release reaches the rail only via the share.
    const rel = await seedRelease({ pubkey: SAGE.pubkey, slug: "only-shared" });
    await seedShare({ by: MARCUS.pubkey, spaceId: "room-a", channelId: "a-music", addr: rel.addr });
    const own = await seedRelease({ pubkey: LUNA.pubkey, slug: "by-creator" });

    const members = (await guestGet("/discovery/spaces/music")).json().data;
    expect(members.tracks.map((r: { id: string }) => r.id)).toEqual([own.id]);
    expect(members.tracks[0].sharedAt).toBeUndefined();
    expect((await shares()).tracks.map((r: { id: string }) => r.id)).toEqual([rel.id]);
  });

  it("rejects an unknown source", async () => {
    expect((await guestGet("/discovery/spaces/music?source=authors")).statusCode).toBe(400);
  });
});
