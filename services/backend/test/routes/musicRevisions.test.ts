/**
 * GET /music/revisions/* is gated by the CURRENT version's visibility, with the
 * same 404 shapes as GET /music/resolve/track (docs/MUSIC_VISIBILITY.md).
 * Before this gate, a private or space-scoped track's whole revision history
 * (full `eventJson`, including old audio URLs) was served to anyone holding
 * the slug (WIR-3).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { revisionService } from "../../src/services/revisionService.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS, SAGE, ZARA } from "../helpers/testUsers.js";

let server: FastifyInstance;

const SLUG = "revgate"; // file-unique slug prefix (cleaned up in afterAll)
const SPACE_ID = "revgate-space";
const PUB = `${SLUG}-pub`;
const PRIV = `${SLUG}-priv`;
const SPACED = `${SLUG}-spaced`;
const NOWHERE = `${SLUG}-nowhere`; // revisions exist, current event does not

const addr = (slug: string) => `31683:${LUNA.pubkey}:${slug}`;

function list(slug: string, viewer: string | null) {
  return server.inject({
    method: "GET",
    url: `/music/revisions/31683/${LUNA.pubkey}/${slug}`,
    headers: viewer ? { "x-auth-pubkey": viewer } : {},
  });
}
function version(slug: string, v: number, viewer: string | null) {
  return server.inject({
    method: "GET",
    url: `/music/revisions/31683/${LUNA.pubkey}/${slug}/${v}`,
    headers: viewer ? { "x-auth-pubkey": viewer } : {},
  });
}

/** Two captured revisions for a slug: v1 (old audio) → v2 (current). */
async function seedRevisions(slug: string, tags: string[][]) {
  const base = { pubkey: LUNA.pubkey, kind: 31683, content: "", sig: "0".repeat(128) };
  await revisionService.captureRevision(addr(slug), {
    ...base,
    id: `${slug}-v1`.padEnd(64, "a"),
    created_at: 1_700_000_000,
    tags: [["d", slug], ["title", "old"], ["imeta", "url https://cdn.test/old.mp3"], ...tags],
  });
  await revisionService.captureRevision(addr(slug), {
    ...base,
    id: `${slug}-v2`.padEnd(64, "b"),
    created_at: 1_700_000_100,
    tags: [["d", slug], ["title", "new"], ["imeta", "url https://cdn.test/new.mp3"], ...tags],
  });
}

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();
  await insertMusicEvent({ kind: 31683, pubkey: LUNA.pubkey, slug: PUB });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: PRIV, visibility: "private",
    pTags: [["p", MARCUS.pubkey, "", "collaborator"], ["p", SAGE.pubkey, "", "featured"]],
  });
  await insertMusicEvent({ kind: 31683, pubkey: LUNA.pubkey, slug: SPACED, hTag: SPACE_ID });
});

beforeEach(async () => {
  // app.* is truncated between tests; relay.events is not.
  await db.insert(spaces).values({
    id: SPACE_ID, hostRelay: "wss://relay.test.com", name: "Rev Gate",
    createdAt: Math.floor(Date.now() / 1000),
  });
  await db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, pubkey: LUNA.pubkey },
    { spaceId: SPACE_ID, pubkey: MARCUS.pubkey },
  ]);
  await seedRevisions(PUB, []);
  await seedRevisions(PRIV, [["visibility", "private"], ["p", MARCUS.pubkey, "", "collaborator"]]);
  await seedRevisions(SPACED, [["h", SPACE_ID]]);
  await seedRevisions(NOWHERE, []);
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  await closeTestServer();
});

describe("GET /music/revisions on a public track", () => {
  it("lists two versions for anyone, authed or not", async () => {
    for (const viewer of [null, ZARA.pubkey]) {
      const res = await list(PUB, viewer);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((r: { version: number }) => r.version)).toEqual([2, 1]);
    }
    const v1 = await version(PUB, 1, null);
    expect(v1.statusCode).toBe(200);
    expect(v1.json().data.eventJson.tags).toContainEqual(["title", "old"]);
  });
});

describe("GET /music/revisions on a private track", () => {
  it("serves the owner and an access-granting collaborator", async () => {
    for (const viewer of [LUNA.pubkey, MARCUS.pubkey]) {
      expect((await list(PRIV, viewer)).statusCode).toBe(200);
      expect((await version(PRIV, 1, viewer)).statusCode).toBe(200);
    }
  });

  it("404s a featured-only credit, a stranger, and anon — list and version", async () => {
    for (const viewer of [SAGE.pubkey, ZARA.pubkey, null]) {
      const l = await list(PRIV, viewer);
      expect(l.statusCode).toBe(404);
      expect(l.body).not.toContain("old.mp3");
      const v = await version(PRIV, 1, viewer);
      expect(v.statusCode).toBe(404);
      expect(v.body).not.toContain("old.mp3");
    }
  });
});

describe("GET /music/revisions on a space-scoped track", () => {
  it("serves a member, 404s a non-member and anon", async () => {
    expect((await list(SPACED, MARCUS.pubkey)).statusCode).toBe(200);
    expect((await version(SPACED, 2, MARCUS.pubkey)).statusCode).toBe(200);
    for (const viewer of [ZARA.pubkey, null]) {
      expect((await list(SPACED, viewer)).statusCode).toBe(404);
      expect((await version(SPACED, 1, viewer)).statusCode).toBe(404);
    }
  });
});

describe("GET /music/revisions when the current event is gone", () => {
  it("404s like /music/resolve/track, even for the would-be owner", async () => {
    expect((await list(NOWHERE, LUNA.pubkey)).statusCode).toBe(404);
    expect((await version(NOWHERE, 1, LUNA.pubkey)).statusCode).toBe(404);
  });
});
