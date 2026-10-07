/**
 * Cover art of private / space-scoped releases (WIR-171, WIR-122 leftover).
 *
 * A cover uploaded through POST /music/upload/cover lands in the backend's
 * own blob store with the uploader recorded as owner, so the moment the
 * author publishes a protected release whose `image` tag points at it, the
 * BUD-01 GET is gated by blobAccess exactly like the audio: author and
 * grantees see it, strangers and anon get a 404. Covers pushed to a public
 * Blossom host by a client are outside this gate — that is the client-side
 * fix soot tracks (upload protected covers here instead).
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { blobs, blobOwners } from "../../src/db/schema/blobs.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { config } from "../../src/config.js";
import { clearBlobAccessCache } from "../../src/services/blobAccess.js";
import { ensureRelayEventsTable, insertMusicEvent, deleteRelayEventsBySlugPrefix } from "../helpers/relayEvents.js";
import { LUNA, MARCUS, SAGE, JAYDEE } from "../helpers/testUsers.js";

let server: FastifyInstance;
const BLOB_DIR = resolve(process.cwd(), config.blobDir);
const SPACE_ID = "cover-gate-space";
const SLUG = "cvgate";
const SHA_PRIVATE = "e".repeat(64); // cover of a private track
const SHA_SPACE = "f".repeat(64); // cover of a space-exclusive track
const SHA_PUBLIC = "ab".repeat(32); // cover of a public track
const SHA_ALBUM = "cd".repeat(32); // cover of a private project (33123)

async function seedCover(sha: string, owner: string) {
  await writeFile(join(BLOB_DIR, sha), Buffer.alloc(256, 7));
  await db.insert(blobs).values({ sha256: sha, size: 256, type: "image/jpeg", uploaded: Math.floor(Date.now() / 1000) }).onConflictDoNothing();
  await db.insert(blobOwners).values({ sha256: sha, pubkey: owner }).onConflictDoNothing();
}

const getBlob = (sha: string, viewer: string | null) =>
  server.inject({ method: "GET", url: `/${sha}`, headers: viewer ? { "x-auth-pubkey": viewer } : {} });

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();
  await mkdir(BLOB_DIR, { recursive: true });
  await deleteRelayEventsBySlugPrefix(SLUG);
  // The `image` tag is the ONLY reference to these shas — no audio imeta.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-private`, visibility: "private",
    imageUrl: `${config.publicUrl}/${SHA_PRIVATE}`, pTags: [["p", SAGE.pubkey, "", "collaborator"]],
  });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-space`, hTag: SPACE_ID,
    imageUrl: `${config.publicUrl}/${SHA_SPACE}`,
  });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-public`,
    imageUrl: `${config.publicUrl}/${SHA_PUBLIC}`,
  });
  await insertMusicEvent({
    kind: 33123, pubkey: LUNA.pubkey, slug: `${SLUG}-album`, visibility: "private",
    imageUrl: `${config.publicUrl}/${SHA_ALBUM}`, pTags: [["p", SAGE.pubkey, "", "collaborator"]],
  });
  await insertMusicEvent({ kind: 33123, pubkey: LUNA.pubkey, slug: `${SLUG}-album-public`, imageUrl: `${config.publicUrl}/${SHA_PUBLIC}` });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  await closeTestServer();
});

beforeEach(async () => {
  clearBlobAccessCache();
  await db.insert(spaces).values({ id: SPACE_ID, hostRelay: "wss://relay.test.com", name: "Cover Gate", createdAt: Math.floor(Date.now() / 1000) });
  await db.insert(spaceMembers).values([{ spaceId: SPACE_ID, pubkey: LUNA.pubkey }, { spaceId: SPACE_ID, pubkey: MARCUS.pubkey }]);
  await seedCover(SHA_PRIVATE, LUNA.pubkey);
  await seedCover(SHA_SPACE, LUNA.pubkey);
  await seedCover(SHA_PUBLIC, LUNA.pubkey);
  await seedCover(SHA_ALBUM, LUNA.pubkey);
});

const access = (path: string, viewer: string | null) =>
  server.inject({ method: "GET", url: `/music/access/${path}`, headers: viewer ? { "x-auth-pubkey": viewer } : {} });

describe("cover art referenced only by an `image` tag", () => {
  it("of a private track: author and collaborator see it, a stranger and anon get 404", async () => {
    expect((await getBlob(SHA_PRIVATE, LUNA.pubkey)).statusCode).toBe(200);
    const granted = await getBlob(SHA_PRIVATE, SAGE.pubkey);
    expect(granted.statusCode).toBe(200);
    expect(granted.headers["content-type"]).toContain("image/jpeg");
    expect(granted.headers["cache-control"]).toContain("no-store");
    expect((await getBlob(SHA_PRIVATE, JAYDEE.pubkey)).statusCode).toBe(404);
    expect((await getBlob(SHA_PRIVATE, null)).statusCode).toBe(404);
  });

  it("of a space-exclusive track: members see it, a non-member and anon get 404", async () => {
    expect((await getBlob(SHA_SPACE, MARCUS.pubkey)).statusCode).toBe(200);
    expect((await getBlob(SHA_SPACE, SAGE.pubkey)).statusCode).toBe(404);
    expect((await getBlob(SHA_SPACE, null)).statusCode).toBe(404);
  });

  it("of a public track: served to anyone, cacheable", async () => {
    const res = await getBlob(SHA_PUBLIC, null);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("a stranger's private event pointing at the author's public cover cannot hide it", async () => {
    await insertMusicEvent({
      kind: 31683, pubkey: JAYDEE.pubkey, slug: `${SLUG}-grief`, visibility: "private",
      imageUrl: `${config.publicUrl}/${SHA_PUBLIC}`,
    });
    clearBlobAccessCache();
    expect((await getBlob(SHA_PUBLIC, null)).statusCode).toBe(200);
  });
});

describe("cover tokens on /music/access (header-less image loaders)", () => {
  it("track route: an authorized viewer gets a cover url with ?tk= that unlocks the blob; a stranger gets 404", async () => {
    const res = await access(`${LUNA.pubkey}/${SLUG}-private`, SAGE.pubkey);
    expect(res.statusCode).toBe(200);
    const { cover } = res.json().data;
    expect(cover).toMatchObject({ sha256: SHA_PRIVATE, gated: true });
    expect(cover.url).toMatch(new RegExp(`/${SHA_PRIVATE}\\?tk=\\d+\\.[0-9a-f]+$`));
    expect(typeof cover.exp).toBe("number");
    const tk = cover.url.split("?tk=")[1];
    expect((await server.inject({ method: "GET", url: `/${SHA_PRIVATE}?tk=${tk}` })).statusCode).toBe(200);
    // The token is bound to the cover sha only.
    expect((await server.inject({ method: "GET", url: `/${SHA_SPACE}?tk=${tk}` })).statusCode).toBe(404);

    expect((await access(`${LUNA.pubkey}/${SLUG}-private`, JAYDEE.pubkey)).statusCode).toBe(404);
    expect((await access(`${LUNA.pubkey}/${SLUG}-private`, null)).statusCode).toBe(404);
  });

  it("album route: same policy for a private project; a public project needs nothing", async () => {
    const res = await access(`album/${LUNA.pubkey}/${SLUG}-album`, SAGE.pubkey);
    expect(res.statusCode).toBe(200);
    const { gated, cover } = res.json().data;
    expect(gated).toBe(true);
    expect(cover).toMatchObject({ sha256: SHA_ALBUM, gated: true });
    const tk = cover.url.split("?tk=")[1];
    expect((await server.inject({ method: "GET", url: `/${SHA_ALBUM}?tk=${tk}` })).statusCode).toBe(200);
    expect((await access(`album/${LUNA.pubkey}/${SLUG}-album`, JAYDEE.pubkey)).statusCode).toBe(404);
    expect((await access(`album/${LUNA.pubkey}/${SLUG}-album`, null)).statusCode).toBe(404);

    expect((await access(`album/${LUNA.pubkey}/${SLUG}-album-public`, null)).json().data).toEqual({ gated: false });
    expect((await access(`album/${LUNA.pubkey}/nope`, null)).statusCode).toBe(404);
  });

  it("a space-scoped track's cover mints for a member only", async () => {
    const member = await access(`${LUNA.pubkey}/${SLUG}-space`, MARCUS.pubkey);
    expect(member.statusCode).toBe(200);
    expect(member.json().data.cover).toMatchObject({ sha256: SHA_SPACE, gated: true });
    expect((await access(`${LUNA.pubkey}/${SLUG}-space`, SAGE.pubkey)).statusCode).toBe(404);
  });
});
