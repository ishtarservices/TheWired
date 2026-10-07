/**
 * Backend contract for shared project keys (WIR-172, B1 + B4).
 *
 * B1: ["p", <human>, "", "owner"] grants read access like `collaborator` —
 *     the event is signed by the project key, so this is how a holder reads
 *     their own gated project as themselves (resolve, blob, cover token).
 * B4: POST /music/blobs/transfer moves the signer's blob ownership to a
 *     successor key; after the move only K2-authored events decide protection,
 *     a replay is a no-op, and nobody can move what they don't own.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { getPublicKey } from "nostr-tools";
import { sha256 as hash } from "@noble/hashes/sha2";
import { eq } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { blobs, blobOwners } from "../../src/db/schema/blobs.js";
import { musicUploads } from "../../src/db/schema/music.js";
import { config } from "../../src/config.js";
import { nanoid } from "../../src/lib/id.js";
import { clearBlobAccessCache } from "../../src/services/blobAccess.js";
import { ensureRelayEventsTable, insertMusicEvent, deleteRelayEventsBySlugPrefix } from "../helpers/relayEvents.js";
import { LUNA, SAGE, JAYDEE } from "../helpers/testUsers.js";

let server: FastifyInstance;
const BLOB_DIR = resolve(process.cwd(), config.blobDir);
const SLUG = "shkey";
// Two project keys: K1 (current) and K2 (successor after rotation).
const K1 = getPublicKey(hash(new TextEncoder().encode("thewired-test-project-key:k1")));
const K2 = getPublicKey(hash(new TextEncoder().encode("thewired-test-project-key:k2")));
const SHA_AUDIO = "1a".repeat(32);
const SHA_COVER = "2b".repeat(32);
const SHA_OTHER = "3c".repeat(32); // owned by LUNA, not by K1

const as = (pk: string | null) => (pk ? { "x-auth-pubkey": pk } : {});

async function seedBlob(sha: string, owner: string, withUpload = false) {
  await writeFile(join(BLOB_DIR, sha), Buffer.alloc(64, 1));
  await db.insert(blobs).values({ sha256: sha, size: 64, type: "audio/mpeg", uploaded: 1 }).onConflictDoNothing();
  await db.insert(blobOwners).values({ sha256: sha, pubkey: owner }).onConflictDoNothing();
  if (withUpload) {
    await db.insert(musicUploads).values({
      id: nanoid(16), pubkey: owner, originalFilename: "t.mp3", storagePath: join(BLOB_DIR, sha),
      url: `${config.publicUrl}/${sha}`, sha256: sha, mimeType: "audio/mpeg", fileSize: 64,
    });
  }
}

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();
  await mkdir(BLOB_DIR, { recursive: true });
  await deleteRelayEventsBySlugPrefix(SLUG);
  // The shared project: a private track signed by K1, naming SAGE as owner
  // and JAYDEE as a featured credit.
  await insertMusicEvent({
    kind: 31683, pubkey: K1, slug: `${SLUG}-track`, visibility: "private",
    imetaSha: SHA_AUDIO, imageUrl: `${config.publicUrl}/${SHA_COVER}`,
    pTags: [["p", SAGE.pubkey, "", "owner"], ["p", JAYDEE.pubkey, "", "featured"]],
  });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  await closeTestServer();
});

beforeEach(async () => {
  clearBlobAccessCache();
  await seedBlob(SHA_AUDIO, K1, true);
  await seedBlob(SHA_COVER, K1);
  await seedBlob(SHA_OTHER, LUNA.pubkey);
});

describe("B1: the `owner` role grants access", () => {
  const track = `/music/resolve/track/${K1}/${SLUG}-track`;
  const access = `/music/access/${K1}/${SLUG}-track`;

  it("an owner resolves, mints audio + cover tokens, and fetches the blob", async () => {
    expect((await server.inject({ method: "GET", url: track, headers: as(SAGE.pubkey) })).statusCode).toBe(200);
    const res = await server.inject({ method: "GET", url: access, headers: as(SAGE.pubkey) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.gated).toBe(true);
    expect(d.cover).toMatchObject({ sha256: SHA_COVER, gated: true });
    expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}?tk=${d.token}` })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}`, headers: as(SAGE.pubkey) })).statusCode).toBe(200);
  });

  it("the project key itself (the author) still has access", async () => {
    expect((await server.inject({ method: "GET", url: access, headers: as(K1) })).statusCode).toBe(200);
  });

  it("a featured credit, a stranger and anon are denied on every layer", async () => {
    for (const viewer of [JAYDEE.pubkey, LUNA.pubkey, null]) {
      expect((await server.inject({ method: "GET", url: track, headers: as(viewer) })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: access, headers: as(viewer) })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}`, headers: as(viewer) })).statusCode).toBe(404);
    }
  });
});

describe("B4: POST /music/blobs/transfer", () => {
  const transfer = (signer: string | null, payload: unknown) =>
    server.inject({ method: "POST", url: "/music/blobs/transfer", headers: as(signer), payload: payload as never });

  async function ownersOf(sha: string) {
    return (await db.select({ pubkey: blobOwners.pubkey }).from(blobOwners).where(eq(blobOwners.sha256, sha))).map((r) => r.pubkey).sort();
  }

  it("moves only the signer's shas to the successor, re-attributes uploads, and reports the rest as skipped", async () => {
    const res = await transfer(K1, { to: K2, shas: [SHA_AUDIO, SHA_COVER, SHA_OTHER, "d".repeat(64)] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ moved: [SHA_AUDIO, SHA_COVER], skipped: [SHA_OTHER, "d".repeat(64)] });
    expect(await ownersOf(SHA_AUDIO)).toEqual([K2]);
    expect(await ownersOf(SHA_COVER)).toEqual([K2]);
    expect(await ownersOf(SHA_OTHER)).toEqual([LUNA.pubkey]);
    const [upload] = await db.select({ pubkey: musicUploads.pubkey }).from(musicUploads).where(eq(musicUploads.sha256, SHA_AUDIO));
    expect(upload.pubkey).toBe(K2);
  });

  it("is idempotent: a replay moves nothing and changes nothing", async () => {
    await transfer(K1, { to: K2, shas: [SHA_AUDIO] });
    const again = await transfer(K1, { to: K2, shas: [SHA_AUDIO] });
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toEqual({ moved: [], skipped: [SHA_AUDIO] });
    expect(await ownersOf(SHA_AUDIO)).toEqual([K2]);
  });

  it("keeps a successor's existing ownership row (shared blob) and drops the signer's", async () => {
    await db.insert(blobOwners).values({ sha256: SHA_AUDIO, pubkey: K2 });
    const res = await transfer(K1, { to: K2, shas: [SHA_AUDIO] });
    expect(res.json().data.moved).toEqual([SHA_AUDIO]);
    expect(await ownersOf(SHA_AUDIO)).toEqual([K2]);
  });

  it("after the move, K1's old private event no longer protects the blob and a K2 event does", async () => {
    // Before: the K1 event gates the audio (a stranger is denied).
    expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}`, headers: as(LUNA.pubkey) })).statusCode).toBe(404);
    await transfer(K1, { to: K2, shas: [SHA_AUDIO, SHA_COVER] });
    // The K1 event is now authored by a non-owner: it neither protects nor exposes;
    // with no owner-authored reference the blob is public by URL until K2 publishes.
    expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}`, headers: as(LUNA.pubkey) })).statusCode).toBe(200);
    // K2 republishes the private track: gated again, for K2's owners.
    await insertMusicEvent({
      kind: 31683, pubkey: K2, slug: `${SLUG}-track-k2`, visibility: "private", imetaSha: SHA_AUDIO,
      pTags: [["p", SAGE.pubkey, "", "owner"]],
    });
    clearBlobAccessCache();
    expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}`, headers: as(LUNA.pubkey) })).statusCode).toBe(404);
    expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}`, headers: as(SAGE.pubkey) })).statusCode).toBe(200);
    // A removed holder who still has K1 cannot re-expose the audio with a public K1 event.
    await insertMusicEvent({ kind: 31683, pubkey: K1, slug: `${SLUG}-leak`, imetaSha: SHA_AUDIO });
    clearBlobAccessCache();
    expect((await server.inject({ method: "GET", url: `/${SHA_AUDIO}`, headers: as(LUNA.pubkey) })).statusCode).toBe(404);
  });

  it("validates: auth required, successor must differ, hex shapes, 1..200 shas", async () => {
    expect((await transfer(null, { to: K2, shas: [SHA_AUDIO] })).statusCode).toBe(401);
    expect((await transfer(K1, { to: K1, shas: [SHA_AUDIO] })).statusCode).toBe(400);
    expect((await transfer(K1, { to: "nope", shas: [SHA_AUDIO] })).statusCode).toBe(400);
    expect((await transfer(K1, { to: K2, shas: [] })).statusCode).toBe(400);
    expect((await transfer(K1, { to: K2, shas: ["xyz"] })).statusCode).toBe(400);
    expect((await transfer(K1, { to: K2, shas: Array.from({ length: 201 }, () => SHA_AUDIO) })).statusCode).toBe(400);
    expect(await ownersOf(SHA_AUDIO)).toEqual([K1]);
  });

  it("a non-owner cannot move someone else's blob", async () => {
    const res = await transfer(SAGE.pubkey, { to: K2, shas: [SHA_AUDIO] });
    expect(res.json().data).toEqual({ moved: [], skipped: [SHA_AUDIO] });
    expect(await ownersOf(SHA_AUDIO)).toEqual([K1]);
  });
});
