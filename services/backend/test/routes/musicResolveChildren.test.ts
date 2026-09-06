/**
 * Regression tests for per-child visibility on album/playlist resolution
 * (backend brief P0.3 / P1.8), the insights visibility gate (P0.6), and the
 * rebuild-counts admin gate (P0.2).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { config } from "../../src/config.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";

let server: FastifyInstance;

const SPACE_ID = "rc-test-space";
const SLUG = "rchild"; // file-unique slug prefix

const REF_PUB = () => `31683:${LUNA.pubkey}:${SLUG}-pub`;
const REF_PRIV = () => `31683:${LUNA.pubkey}:${SLUG}-priv`;
const REF_SPACE = () => `31683:${LUNA.pubkey}:${SLUG}-space`;
const REF_MISSING = () => `31683:${LUNA.pubkey}:${SLUG}-missing`;

function trackTitles(res: { json(): { data: { tracks: { tags: string[][] }[] } } }): string[] {
  return res.json().data.tracks.map(
    (t) => t.tags.find((tag) => tag[0] === "title")?.[1] ?? "",
  );
}

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();
});

beforeEach(async () => {
  await db.insert(spaces).values({
    id: SPACE_ID,
    hostRelay: "wss://relay.test.com",
    name: "Resolve Children Test",
    createdAt: Math.floor(Date.now() / 1000),
  });
  await db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, pubkey: LUNA.pubkey },
    { spaceId: SPACE_ID, pubkey: MARCUS.pubkey },
  ]);

  await insertMusicEvent({ kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-pub` });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-priv`,
    visibility: "private", pTags: [["p", MARCUS.pubkey, "", "collaborator"]],
  });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-space`, hTag: SPACE_ID,
  });

  const children = [REF_PUB(), REF_PRIV(), REF_SPACE(), REF_MISSING()];
  await insertMusicEvent({
    kind: 33123, pubkey: LUNA.pubkey, slug: `${SLUG}-album`, aTags: children,
  });
  await insertMusicEvent({
    kind: 30119, pubkey: LUNA.pubkey, slug: `${SLUG}-playlist`, aTags: children,
  });
  await insertMusicEvent({
    kind: 30119, pubkey: LUNA.pubkey, slug: `${SLUG}-playlist-priv`, visibility: "private",
  });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  await closeTestServer();
});

describe("GET /music/resolve/album — child track visibility", () => {
  it("returns only public children to an unauthenticated viewer", async () => {
    const res = await server.inject({
      method: "GET", url: `/music/resolve/album/${LUNA.pubkey}/${SLUG}-album`,
    });
    expect(res.statusCode).toBe(200);
    expect(trackTitles(res)).toEqual([`T ${SLUG}-pub`]);
  });

  it("returns collaborator + space children to an authorized member", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/album/${LUNA.pubkey}/${SLUG}-album`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(res.statusCode).toBe(200);
    expect(trackTitles(res)).toEqual([
      `T ${SLUG}-pub`, `T ${SLUG}-priv`, `T ${SLUG}-space`,
    ]);
  });

  it("hides private and space children from an unrelated viewer", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/album/${LUNA.pubkey}/${SLUG}-album`,
      headers: { "x-auth-pubkey": SAGE.pubkey },
    });
    expect(res.statusCode).toBe(200);
    expect(trackTitles(res)).toEqual([`T ${SLUG}-pub`]);
  });
});

describe("GET /music/resolve/playlist", () => {
  it("resolves a public playlist with visibility-filtered, ordered children", async () => {
    const res = await server.inject({
      method: "GET", url: `/music/resolve/playlist/${LUNA.pubkey}/${SLUG}-playlist`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.event.kind).toBe(30119);
    expect(trackTitles(res)).toEqual([`T ${SLUG}-pub`]);
  });

  it("404s an unknown playlist", async () => {
    expect(
      (await server.inject({
        method: "GET", url: `/music/resolve/playlist/${LUNA.pubkey}/${SLUG}-nope`,
      })).statusCode,
    ).toBe(404);
  });

  it("404s a private playlist for a non-owner, resolves it for the owner", async () => {
    expect(
      (await server.inject({
        method: "GET", url: `/music/resolve/playlist/${LUNA.pubkey}/${SLUG}-playlist-priv`,
      })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/resolve/playlist/${LUNA.pubkey}/${SLUG}-playlist-priv`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
      })).statusCode,
    ).toBe(200);
  });
});

describe("GET /music/insights — visibility gate", () => {
  it("serves insights for a public track without auth", async () => {
    const res = await server.inject({
      method: "GET", url: `/music/insights/${REF_PUB()}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.totalPlays).toBe(0);
  });

  it("404s insights for a private track without auth, serves them to the owner", async () => {
    expect(
      (await server.inject({ method: "GET", url: `/music/insights/${REF_PRIV()}` })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/insights/${REF_PRIV()}`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
      })).statusCode,
    ).toBe(200);
  });

  it("404s insights for a space track to a non-member, serves them to a member", async () => {
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/insights/${REF_SPACE()}`,
        headers: { "x-auth-pubkey": SAGE.pubkey },
      })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/insights/${REF_SPACE()}`,
        headers: { "x-auth-pubkey": MARCUS.pubkey },
      })).statusCode,
    ).toBe(200);
  });
});

describe("POST /music/rebuild-counts — admin gate", () => {
  it("403s a regular authenticated user", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/music/rebuild-counts",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s an unauthenticated request", async () => {
    expect(
      (await server.inject({ method: "POST", url: "/music/rebuild-counts" })).statusCode,
    ).toBe(403);
  });

  it("allows a configured admin", async () => {
    (config.adminPubkeys as unknown as string[]).push(LUNA.pubkey);
    try {
      const res = await server.inject({
        method: "POST",
        url: "/music/rebuild-counts",
        headers: { "x-auth-pubkey": LUNA.pubkey },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      (config.adminPubkeys as unknown as string[]).pop();
    }
  });
});
