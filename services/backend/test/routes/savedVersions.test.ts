/**
 * Saved-version update tracking (WIR-165).
 *
 * The bug: the ingester flagged `has_update` for every 31683/33123 event it saw
 * (and the music backfill re-sends every event on each reconnect), so saved
 * projects showed "Update Available" forever. These tests pin the contract:
 *  - re-ingesting the saved event or an OLDER one never flags;
 *  - a strictly newer event flags once and records `latest_*`;
 *  - acknowledging resolves to the newest known version even when the client
 *    sends a stale one, so the flag can't come straight back;
 *  - saving after the ingester already saw a newer event keeps the flag;
 *  - non-public events flag only the fans they are addressed to;
 *  - routes: save / list / acknowledge / forget, auth required.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";
import { savedVersionService } from "../../src/services/savedVersionService.js";

const ADDR = `33123:${MARCUS.pubkey}:ep-one`;
const V1 = { id: "1".repeat(64), created_at: 1_700_000_000 };
const V2 = { id: "2".repeat(64), created_at: 1_700_000_100 };
const V3 = { id: "3".repeat(64), created_at: 1_700_000_200 };

function albumEvent(v: { id: string; created_at: number }, extraTags: string[][] = []) {
  return {
    id: v.id,
    pubkey: MARCUS.pubkey,
    kind: 33123,
    created_at: v.created_at,
    tags: [["d", "ep-one"], ["title", "EP One"], ...extraTags],
  };
}

let server: FastifyInstance;
beforeAll(async () => {
  server = await buildTestServer();
});

async function rowFor(pubkey: string) {
  return (await savedVersionService.list(pubkey)).find((r) => r.addressableId === ADDR);
}

describe("savedVersionService.flagUpdates", () => {
  it("does not flag when the saved event is re-ingested (relay backfill)", async () => {
    await savedVersionService.save(LUNA.pubkey, ADDR, V1.id, V1.created_at);
    expect(await savedVersionService.flagUpdates(albumEvent(V1))).toBe(0);
    expect((await rowFor(LUNA.pubkey))?.hasUpdate).toBe(false);
  });

  it("does not flag for an older event than the saved one", async () => {
    await savedVersionService.save(LUNA.pubkey, ADDR, V2.id, V2.created_at);
    expect(await savedVersionService.flagUpdates(albumEvent(V1))).toBe(0);
    expect((await rowFor(LUNA.pubkey))?.hasUpdate).toBe(false);
  });

  it("flags once for a strictly newer event and records it; re-ingest is a no-op", async () => {
    await savedVersionService.save(LUNA.pubkey, ADDR, V1.id, V1.created_at);
    expect(await savedVersionService.flagUpdates(albumEvent(V2))).toBe(1);
    const row = await rowFor(LUNA.pubkey);
    expect(row).toMatchObject({ hasUpdate: true, latestEventId: V2.id, latestCreatedAt: V2.created_at, savedEventId: V1.id });

    // Same event again (backfill): nothing changes.
    expect(await savedVersionService.flagUpdates(albumEvent(V2))).toBe(0);
    // An even newer one moves `latest_*` forward…
    expect(await savedVersionService.flagUpdates(albumEvent(V3))).toBe(1);
    // …and an out-of-order older-but-still-newer-than-saved event never moves it back.
    expect(await savedVersionService.flagUpdates(albumEvent(V2))).toBe(0);
    expect(await rowFor(LUNA.pubkey)).toMatchObject({ latestEventId: V3.id, latestCreatedAt: V3.created_at });
  });

  it("flags a non-public event only for the fans it is addressed to", async () => {
    await savedVersionService.save(LUNA.pubkey, ADDR, V1.id, V1.created_at);
    await savedVersionService.save(SAGE.pubkey, ADDR, V1.id, V1.created_at);
    const privateV2 = albumEvent(V2, [["visibility", "private"], ["p", SAGE.pubkey, "", "collaborator"]]);
    expect(await savedVersionService.flagUpdates(privateV2, [SAGE.pubkey])).toBe(1);
    expect((await rowFor(LUNA.pubkey))?.hasUpdate).toBe(false);
    expect((await rowFor(SAGE.pubkey))?.hasUpdate).toBe(true);
    // Addressed to nobody → nobody is flagged.
    expect(await savedVersionService.flagUpdates(albumEvent(V3), [])).toBe(0);
  });
});

describe("savedVersionService.save / acknowledge", () => {
  it("saving after the ingester already saw a newer event keeps the flag", async () => {
    await savedVersionService.save(LUNA.pubkey, ADDR, V1.id, V1.created_at);
    await savedVersionService.flagUpdates(albumEvent(V3));
    // Re-saving the same old version (e.g. library re-sync) must not clear a real update…
    expect((await savedVersionService.save(LUNA.pubkey, ADDR, V1.id, V1.created_at)).hasUpdate).toBe(true);
    // …but saving the newest version does.
    expect((await savedVersionService.save(LUNA.pubkey, ADDR, V3.id, V3.created_at)).hasUpdate).toBe(false);
  });

  it("acknowledging with a stale client version resolves to the newest known event", async () => {
    await savedVersionService.save(LUNA.pubkey, ADDR, V1.id, V1.created_at);
    await savedVersionService.flagUpdates(albumEvent(V3));
    // Client still holds V2 (never received V3).
    const row = await savedVersionService.acknowledge(LUNA.pubkey, ADDR, V2.id, V2.created_at);
    expect(row).toMatchObject({ hasUpdate: false, savedEventId: V3.id, savedCreatedAt: V3.created_at });
    // The ingester re-sending V3 (backfill) can't bring the flag back.
    expect(await savedVersionService.flagUpdates(albumEvent(V3))).toBe(0);
  });

  it("acknowledging with a version newer than the ingester's wins", async () => {
    await savedVersionService.save(LUNA.pubkey, ADDR, V1.id, V1.created_at);
    await savedVersionService.flagUpdates(albumEvent(V2));
    const row = await savedVersionService.acknowledge(LUNA.pubkey, ADDR, V3.id, V3.created_at);
    expect(row).toMatchObject({ hasUpdate: false, savedEventId: V3.id, savedCreatedAt: V3.created_at });
  });

  it("acknowledging an item that was never saved returns null", async () => {
    expect(await savedVersionService.acknowledge(LUNA.pubkey, ADDR, V1.id, V1.created_at)).toBeNull();
  });
});

describe("savedVersionService.saveMany / forget", () => {
  const T1 = `31683:${MARCUS.pubkey}:t1`;
  const T2 = `31683:${MARCUS.pubkey}:t2`;

  it("upserts a batch, keeping the flag where the ingester already knows newer", async () => {
    await savedVersionService.save(LUNA.pubkey, T1, V1.id, V1.created_at);
    await savedVersionService.flagUpdates({ ...albumEvent(V2), kind: 31683, tags: [["d", "t1"]] });
    const rows = await savedVersionService.saveMany(LUNA.pubkey, [
      { addressableId: T1, eventId: V1.id, createdAt: V1.created_at }, // stale re-save: flag stays
      { addressableId: T2, eventId: V1.id, createdAt: V1.created_at },
      { addressableId: T2, eventId: V2.id, createdAt: V2.created_at }, // duplicate in batch: last wins
    ]);
    expect(rows.find((r) => r.addressableId === T1)).toMatchObject({ hasUpdate: true, latestEventId: V2.id });
    expect(rows.find((r) => r.addressableId === T2)).toMatchObject({ hasUpdate: false, savedEventId: V2.id });
    expect(rows).toHaveLength(2);

    await savedVersionService.forget(LUNA.pubkey, [T1, T2]);
    expect(await savedVersionService.list(LUNA.pubkey)).toEqual([]);
  });
});

describe("routes", () => {
  const auth = { "x-auth-pubkey": LUNA.pubkey, "content-type": "application/json" };

  it("requires auth", async () => {
    for (const [method, url] of [["GET", "/music/saved-updates"], ["POST", "/music/save-version"], ["POST", "/music/acknowledge-update"], ["DELETE", "/music/save-version"]] as const) {
      const res = await server.inject({ method, url, payload: method === "GET" ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("save → list → acknowledge → forget", async () => {
    let res = await server.inject({ method: "POST", url: "/music/save-version", headers: auth, payload: { addressableId: ADDR, eventId: V1.id, createdAt: V1.created_at } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ addressableId: ADDR, savedEventId: V1.id, hasUpdate: false, latestEventId: null });

    await savedVersionService.flagUpdates(albumEvent(V2));

    res = await server.inject({ method: "GET", url: "/music/saved-updates", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      expect.objectContaining({ addressableId: ADDR, hasUpdate: true, latestEventId: V2.id, latestCreatedAt: V2.created_at }),
    ]);

    res = await server.inject({ method: "POST", url: "/music/acknowledge-update", headers: auth, payload: { addressableId: ADDR, eventId: V1.id, createdAt: V1.created_at } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ hasUpdate: false, savedEventId: V2.id, savedCreatedAt: V2.created_at });

    res = await server.inject({ method: "DELETE", url: "/music/save-version", headers: auth, payload: { addressableId: ADDR } });
    expect(res.statusCode).toBe(200);
    res = await server.inject({ method: "GET", url: "/music/saved-updates", headers: auth });
    expect(res.json().data).toEqual([]);
  });

  it("batch save + batch forget", async () => {
    const T1 = `31683:${MARCUS.pubkey}:t1`;
    let res = await server.inject({ method: "POST", url: "/music/save-versions", headers: auth, payload: { items: [
      { addressableId: ADDR, eventId: V1.id, createdAt: V1.created_at },
      { addressableId: T1, eventId: V1.id, createdAt: V1.created_at },
    ] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
    res = await server.inject({ method: "POST", url: "/music/save-versions", headers: auth, payload: { items: [] } });
    expect(res.statusCode).toBe(400);
    res = await server.inject({ method: "DELETE", url: "/music/save-version", headers: auth, payload: { addressableIds: [ADDR, T1] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ forgotten: 2 });
    res = await server.inject({ method: "GET", url: "/music/saved-updates", headers: auth });
    expect(res.json().data).toEqual([]);
  });

  it("rejects malformed bodies and a 404 for acknowledging an unsaved item", async () => {
    let res = await server.inject({ method: "POST", url: "/music/save-version", headers: auth, payload: { addressableId: ADDR, eventId: "nope", createdAt: 1 } });
    expect(res.statusCode).toBe(400);
    res = await server.inject({ method: "POST", url: "/music/acknowledge-update", headers: auth, payload: { addressableId: ADDR, eventId: V1.id, createdAt: V1.created_at } });
    expect(res.statusCode).toBe(404);
  });

  it("another user's saved versions are not visible", async () => {
    await savedVersionService.save(MARCUS.pubkey, ADDR, V1.id, V1.created_at);
    const res = await server.inject({ method: "GET", url: "/music/saved-updates", headers: auth });
    expect(res.json().data).toEqual([]);
  });
});
