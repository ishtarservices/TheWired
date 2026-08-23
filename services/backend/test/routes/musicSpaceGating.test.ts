/**
 * Regression tests for space-scoped (`h`-tag) media gating and the deterministic
 * per-sha blob-protection semantics (backend brief P0.1 / P0.4 / P0.5).
 *
 * The core regression: an event carrying ONLY ["h", spaceId] (no visibility tag,
 * the shape soot mobile publishes for space uploads) must protect its blob and
 * the whole HLS ladder — previously only `visibility`-tagged events did.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { blobs, blobOwners } from "../../src/db/schema/blobs.js";
import { musicUploads } from "../../src/db/schema/music.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { config } from "../../src/config.js";
import { nanoid } from "../../src/lib/id.js";
import { clearBlobAccessCache } from "../../src/services/blobAccess.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS, SAGE, ZARA } from "../helpers/testUsers.js";

let server: FastifyInstance;
const BLOB_DIR = resolve(process.cwd(), config.blobDir);

const SPACE_ID = "sg-test-space";
const SLUG = "sgate"; // file-unique slug prefix (cleaned up in afterAll)

const SHA_SPACE = "3".repeat(64); // referenced only by an h-tagged event
const SHA_GRIEF = "4".repeat(64); // public track; a NON-owner publishes a private ref
const SHA_MIXED = "5".repeat(64); // one owner references it publicly AND privately
const SHA_ROLES = "6".repeat(64); // private track with role-annotated p-tags

async function seedBlob(sha: string, ownerPubkey: string, withHls = false) {
  await writeFile(join(BLOB_DIR, sha), Buffer.alloc(1024, 1));
  await db.insert(blobs).values({
    sha256: sha, size: 1024, type: "audio/mpeg", uploaded: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing();
  await db.insert(blobOwners).values({ sha256: sha, pubkey: ownerPubkey }).onConflictDoNothing();
  if (withHls) {
    await db.insert(musicUploads).values({
      id: nanoid(16), pubkey: ownerPubkey, originalFilename: "t.mp3",
      storagePath: join(BLOB_DIR, sha), url: `${config.publicUrl}/${sha}`,
      sha256: sha, mimeType: "audio/mpeg", fileSize: 1024,
      transcodeStatus: "ready", hlsMasterPath: `hls/${sha}/master.m3u8`, transcodedAt: new Date(),
    });
  }
}

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();

  for (const sha of [SHA_SPACE, SHA_GRIEF, SHA_MIXED, SHA_ROLES]) {
    await writeFile(join(BLOB_DIR, sha), Buffer.alloc(1024, 1));
  }
  await mkdir(join(BLOB_DIR, "hls", SHA_SPACE, "128k"), { recursive: true });
  await writeFile(
    join(BLOB_DIR, "hls", SHA_SPACE, "master.m3u8"),
    "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=160000\n128k/index.m3u8\n",
  );
  await writeFile(join(BLOB_DIR, "hls", SHA_SPACE, "128k", "index.m3u8"), "#EXTM3U\n");
  await writeFile(join(BLOB_DIR, "hls", SHA_SPACE, "128k", "seg_00000.m4s"), Buffer.alloc(8));
});

beforeEach(async () => {
  clearBlobAccessCache();

  await db.insert(spaces).values({
    id: SPACE_ID,
    hostRelay: "wss://relay.test.com",
    name: "Space Gating Test",
    createdAt: Math.floor(Date.now() / 1000),
  });
  await db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, pubkey: LUNA.pubkey },
    { spaceId: SPACE_ID, pubkey: MARCUS.pubkey },
  ]);

  await seedBlob(SHA_SPACE, LUNA.pubkey, true);
  await seedBlob(SHA_GRIEF, LUNA.pubkey);
  await seedBlob(SHA_MIXED, LUNA.pubkey);
  await seedBlob(SHA_ROLES, LUNA.pubkey);

  // h-only space track (mobile's shape: no visibility tag, just ["h", spaceId])
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-space`,
    hTag: SPACE_ID, imetaSha: SHA_SPACE,
  });

  // Public track by LUNA; ZARA (who never uploaded the blob) publishes a
  // private event referencing the same sha — must NOT protect the blob.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-pub`, imetaSha: SHA_GRIEF,
  });
  await insertMusicEvent({
    kind: 31683, pubkey: ZARA.pubkey, slug: `${SLUG}-grief`,
    visibility: "private", imetaSha: SHA_GRIEF,
  });

  // One owner references SHA_MIXED both privately and publicly → public wins.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-mixed-priv`,
    visibility: "private", imetaSha: SHA_MIXED,
  });
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-mixed-pub`, imetaSha: SHA_MIXED,
  });

  // Private track with role-annotated p-tags: collaborator, artist, featured.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-roles`,
    visibility: "private", imetaSha: SHA_ROLES,
    pTags: [
      ["p", MARCUS.pubkey, "", "collaborator"],
      ["p", SAGE.pubkey, "", "featured"],
    ],
  });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  for (const sha of [SHA_SPACE, SHA_GRIEF, SHA_MIXED, SHA_ROLES]) {
    await rm(join(BLOB_DIR, sha), { force: true }).catch(() => {});
  }
  await rm(join(BLOB_DIR, "hls", SHA_SPACE), { recursive: true, force: true }).catch(() => {});
  await closeTestServer();
});

describe("h-only space tracks protect the blob + HLS ladder", () => {
  it("denies an unauthenticated raw-blob GET", async () => {
    expect((await server.inject({ method: "GET", url: `/${SHA_SPACE}` })).statusCode).toBe(404);
  });

  it("denies the whole unauthenticated HLS ladder", async () => {
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_SPACE}/master.m3u8` })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_SPACE}/128k/index.m3u8` })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_SPACE}/128k/seg_00000.m4s` })).statusCode,
    ).toBe(404);
  });

  it("serves the blob to a space member via NIP-98 pubkey", async () => {
    const res = await server.inject({
      method: "GET", url: `/${SHA_SPACE}`, headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("denies the blob to a non-member", async () => {
    expect(
      (await server.inject({
        method: "GET", url: `/${SHA_SPACE}`, headers: { "x-auth-pubkey": SAGE.pubkey },
      })).statusCode,
    ).toBe(404);
  });

  it("mints a token for a member via /music/access and it unlocks blob + HLS", async () => {
    const access = await server.inject({
      method: "GET",
      url: `/music/access/${LUNA.pubkey}/${SLUG}-space`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(access.statusCode).toBe(200);
    const d = access.json().data;
    expect(d.gated).toBe(true);

    expect(
      (await server.inject({ method: "GET", url: `/${SHA_SPACE}?tk=${d.token}` })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_SPACE}/master.m3u8?tk=${d.token}` }))
        .statusCode,
    ).toBe(200);
  });

  it("refuses /music/access to a non-member and without auth", async () => {
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/access/${LUNA.pubkey}/${SLUG}-space`,
        headers: { "x-auth-pubkey": SAGE.pubkey },
      })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: `/music/access/${LUNA.pubkey}/${SLUG}-space` }))
        .statusCode,
    ).toBe(404);
  });
});

describe("deterministic per-sha protection semantics", () => {
  it("a non-owner's private event cannot protect (DoS) a public track's blob", async () => {
    const res = await server.inject({ method: "GET", url: `/${SHA_GRIEF}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("an owner's public reference overrides their own private reference", async () => {
    expect((await server.inject({ method: "GET", url: `/${SHA_MIXED}` })).statusCode).toBe(200);
  });
});

describe("p-tag role semantics on private tracks", () => {
  it("grants a collaborator, denies a featured credit (route + blob layers)", async () => {
    // /music/access
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/access/${LUNA.pubkey}/${SLUG}-roles`,
        headers: { "x-auth-pubkey": MARCUS.pubkey },
      })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/access/${LUNA.pubkey}/${SLUG}-roles`,
        headers: { "x-auth-pubkey": SAGE.pubkey },
      })).statusCode,
    ).toBe(404);

    // raw blob via NIP-98 pubkey
    expect(
      (await server.inject({
        method: "GET", url: `/${SHA_ROLES}`, headers: { "x-auth-pubkey": MARCUS.pubkey },
      })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({
        method: "GET", url: `/${SHA_ROLES}`, headers: { "x-auth-pubkey": SAGE.pubkey },
      })).statusCode,
    ).toBe(404);
  });

  it("keeps granting for legacy role-less p-tags", async () => {
    clearBlobAccessCache();
    await insertMusicEvent({
      kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-legacy`,
      visibility: "private", pTags: [["p", SAGE.pubkey]],
    });
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/resolve/track/${LUNA.pubkey}/${SLUG}-legacy`,
        headers: { "x-auth-pubkey": SAGE.pubkey },
      })).statusCode,
    ).toBe(200);
  });
});
