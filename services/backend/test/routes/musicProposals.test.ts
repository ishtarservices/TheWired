/**
 * GET /music/proposals/:pubkey/:slug is gated by the TARGET PROJECT's
 * visibility, with the same 404 shapes as GET /music/resolve/album: a missing
 * project is "Album not found", and a project the viewer may not see is the
 * generic "Not found" from checkEventVisibility. Without this, a private
 * project's proposal titles and track refs leaked to anyone holding the slug.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { musicProposals } from "../../src/db/schema/proposals.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { nanoid } from "../../src/lib/id.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS, SAGE, ZARA, DECKARD, JAYDEE } from "../helpers/testUsers.js";

let server: FastifyInstance;

const SLUG = "proplist"; // file-unique slug prefix (cleaned up in afterAll)
const SPACE_ID = "proplist-space";
const PUB = `${SLUG}-pub`;
const PRIV = `${SLUG}-priv`;
const SPACED = `${SLUG}-spaced`;

const target = (slug: string) => `33123:${LUNA.pubkey}:${slug}`;

async function seedProposal(slug: string, proposer: string, title: string) {
  await db.insert(musicProposals).values({
    id: nanoid(16),
    proposalId: `${slug}-${title}`,
    addressableId: `31685:${proposer}:${slug}-${title}`,
    targetAlbum: target(slug),
    proposerPubkey: proposer,
    ownerPubkey: LUNA.pubkey,
    title,
    changes: [{ type: "add_track", trackRef: `31683:${proposer}:secret-wip` }],
    status: "open",
    eventId: nanoid(16),
    createdAt: Math.floor(Date.now() / 1000),
  });
}

function list(slug: string, viewer: string | null) {
  return server.inject({
    method: "GET",
    url: `/music/proposals/${LUNA.pubkey}/${slug}`,
    headers: viewer ? { "x-auth-pubkey": viewer } : {},
  });
}

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();

  await insertMusicEvent({ kind: 33123, pubkey: LUNA.pubkey, slug: PUB });
  await insertMusicEvent({
    kind: 33123, pubkey: LUNA.pubkey, slug: PRIV, visibility: "private",
    pTags: [
      ["p", MARCUS.pubkey, "", "collaborator"],
      ["p", DECKARD.pubkey, "", "contributor"],
      ["p", JAYDEE.pubkey, "", "editor"],
      ["p", SAGE.pubkey, "", "featured"],
    ],
  });
  await insertMusicEvent({ kind: 33123, pubkey: LUNA.pubkey, slug: SPACED, hTag: SPACE_ID });
});

beforeEach(async () => {
  await db.insert(spaces).values({
    id: SPACE_ID,
    hostRelay: "wss://relay.test.com",
    name: "Proposal List Test",
    createdAt: Math.floor(Date.now() / 1000),
  });
  await db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, pubkey: LUNA.pubkey },
    { spaceId: SPACE_ID, pubkey: MARCUS.pubkey },
  ]);

  await seedProposal(PUB, MARCUS.pubkey, "public-one");
  await seedProposal(PRIV, DECKARD.pubkey, "private-one");
  await seedProposal(PRIV, JAYDEE.pubkey, "private-two");
  await seedProposal(SPACED, MARCUS.pubkey, "space-one");
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  await closeTestServer();
});

describe("GET /music/proposals/:pubkey/:slug on a public project", () => {
  it("lists for anyone, authed or not", async () => {
    for (const viewer of [null, ZARA.pubkey, LUNA.pubkey]) {
      const res = await list(PUB, viewer);
      expect(res.statusCode).toBe(200);
      const titles = res.json().data.map((p: { title: string }) => p.title);
      expect(titles).toEqual(["public-one"]);
    }
  });
});

describe("GET /music/proposals/:pubkey/:slug on a private project", () => {
  it("lists for the owner", async () => {
    const res = await list(PRIV, LUNA.pubkey);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(2);
  });

  it("lists for collaborator, contributor, and editor p-tags", async () => {
    for (const viewer of [MARCUS.pubkey, DECKARD.pubkey, JAYDEE.pubkey]) {
      const res = await list(PRIV, viewer);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(2);
    }
  });

  it("404s for a featured-only credit, a stranger, and anon (no leak)", async () => {
    for (const viewer of [SAGE.pubkey, ZARA.pubkey, null]) {
      const res = await list(PRIV, viewer);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Not found", code: "NOT_FOUND" });
      expect(JSON.stringify(res.json())).not.toContain("secret-wip");
    }
  });
});

describe("GET /music/proposals/:pubkey/:slug on a space-scoped project", () => {
  it("lists for a member, 404s for a non-member and anon", async () => {
    expect((await list(SPACED, MARCUS.pubkey)).statusCode).toBe(200);
    expect((await list(SPACED, ZARA.pubkey)).statusCode).toBe(404);
    expect((await list(SPACED, null)).statusCode).toBe(404);
  });
});

describe("GET /music/proposals/:pubkey/:slug on an unknown project", () => {
  it("404s like /music/resolve/album, even for the would-be owner", async () => {
    // Proposals may be indexed before their project arrives; they stay
    // invisible over REST until the project itself resolves.
    await seedProposal(`${SLUG}-missing`, MARCUS.pubkey, "orphan");
    for (const viewer of [LUNA.pubkey, MARCUS.pubkey, null]) {
      const res = await list(`${SLUG}-missing`, viewer);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Album not found", code: "NOT_FOUND" });
    }
  });
});
