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
import { sql } from "drizzle-orm";
import { nanoid } from "../../src/lib/id.js";
import { clearBlobAccessCache } from "../../src/services/blobAccess.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";
import { LUNA, MARCUS, SAGE, ZARA, DECKARD, JAYDEE } from "../helpers/testUsers.js";

let server: FastifyInstance;
const BLOB_DIR = resolve(process.cwd(), config.blobDir);

const SPACE_ID = "sg-test-space";
const SPACE_B = "sg-test-space-b"; // second space for the multi-h track
const SLUG = "sgate"; // file-unique slug prefix (cleaned up in afterAll)

const SHA_SPACE = "3".repeat(64); // referenced only by an h-tagged event
const SHA_GRIEF = "4".repeat(64); // public track; a NON-owner publishes a private ref
const SHA_MIXED = "5".repeat(64); // one owner references it publicly AND privately
const SHA_ROLES = "6".repeat(64); // private track with role-annotated p-tags
const SHA_MULTI = "7".repeat(64); // track shared into SPACE_ID and SPACE_B
const SHA_MEMBERS = "8".repeat(64); // private track with contributor/editor member roles (+HLS)
const SHA_SPACE_GRANT = "9".repeat(64); // space track carrying a p-tag grant for a non-member (+HLS)
const SHA_STEAL = "a".repeat(64); // LUNA's private sha; ZARA publishes her own private track pointing at it
const SHA_BOTH = "b".repeat(64); // track that is BOTH space-scoped and private
const SHA_NATIVE = "c".repeat(64); // track in a NIP-29-native group (relay.group_members, no app.spaces row)
const SHA_ODDVIS = "d".repeat(64); // track with an unknown visibility value
const NATIVE_GROUP = "sg-native-group";

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
  // CI runners start without the blob dir; nothing else is guaranteed to create it first.
  await mkdir(BLOB_DIR, { recursive: true });

  for (const sha of [SHA_SPACE, SHA_GRIEF, SHA_MIXED, SHA_ROLES, SHA_MULTI, SHA_MEMBERS, SHA_SPACE_GRANT, SHA_STEAL, SHA_BOTH, SHA_NATIVE, SHA_ODDVIS]) {
    await writeFile(join(BLOB_DIR, sha), Buffer.alloc(1024, 1));
  }
  for (const sha of [SHA_SPACE, SHA_MULTI, SHA_MEMBERS, SHA_SPACE_GRANT]) {
    await mkdir(join(BLOB_DIR, "hls", sha, "128k"), { recursive: true });
    await writeFile(
      join(BLOB_DIR, "hls", sha, "master.m3u8"),
      "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=160000\n128k/index.m3u8\n",
    );
    await writeFile(join(BLOB_DIR, "hls", sha, "128k", "index.m3u8"), "#EXTM3U\n");
    await writeFile(join(BLOB_DIR, "hls", sha, "128k", "seg_00000.m4s"), Buffer.alloc(8));
  }
});

beforeEach(async () => {
  clearBlobAccessCache();

  await db.insert(spaces).values({
    id: SPACE_ID,
    hostRelay: "wss://relay.test.com",
    name: "Space Gating Test",
    createdAt: Math.floor(Date.now() / 1000),
  });
  await db.insert(spaces).values({
    id: SPACE_B,
    hostRelay: "wss://relay.test.com",
    name: "Space Gating Test B",
    createdAt: Math.floor(Date.now() / 1000),
  });
  // SAGE is in SPACE_B only (and stays a non-member of SPACE_ID for the
  // single-h tests above); ZARA is in neither.
  await db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, pubkey: LUNA.pubkey },
    { spaceId: SPACE_ID, pubkey: MARCUS.pubkey },
    { spaceId: SPACE_B, pubkey: LUNA.pubkey },
    { spaceId: SPACE_B, pubkey: SAGE.pubkey },
  ]);

  await seedBlob(SHA_SPACE, LUNA.pubkey, true);
  await seedBlob(SHA_GRIEF, LUNA.pubkey);
  await seedBlob(SHA_MIXED, LUNA.pubkey);
  await seedBlob(SHA_ROLES, LUNA.pubkey);
  await seedBlob(SHA_MULTI, LUNA.pubkey, true);
  await seedBlob(SHA_MEMBERS, LUNA.pubkey, true);
  await seedBlob(SHA_SPACE_GRANT, LUNA.pubkey, true);
  await seedBlob(SHA_STEAL, LUNA.pubkey);
  await seedBlob(SHA_BOTH, LUNA.pubkey);
  await seedBlob(SHA_NATIVE, LUNA.pubkey);
  await seedBlob(SHA_ODDVIS, LUNA.pubkey);

  // NIP-29-native group hosted on this relay: membership lives ONLY in
  // relay.group_members (no app.spaces / app.space_members row). DECKARD is in it.
  await db.execute(sql`INSERT INTO relay.groups (group_id, name) VALUES (${NATIVE_GROUP}, 'Native') ON CONFLICT DO NOTHING`);
  await db.execute(sql`DELETE FROM relay.group_members WHERE group_id = ${NATIVE_GROUP}`);
  await db.execute(sql`INSERT INTO relay.group_members (group_id, pubkey) VALUES (${NATIVE_GROUP}, ${DECKARD.pubkey}), (${NATIVE_GROUP}, ${LUNA.pubkey})`);

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

  // Track shared into TWO spaces: ["h", SPACE_ID], ["h", SPACE_B].
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-multi`,
    hTags: [SPACE_ID, SPACE_B], imetaSha: SHA_MULTI,
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

  // Space-scoped track that ALSO grants a non-member via p-tag (WIR-76): the
  // grantee must get the same access as a member on every layer; a featured
  // credit on the same event stays a credit.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-space-grant`,
    hTag: SPACE_ID, imetaSha: SHA_SPACE_GRANT,
    pTags: [
      ["p", JAYDEE.pubkey, "", "collaborator"],
      ["p", SAGE.pubkey, "", "featured"],
    ],
  });

  // LUNA's private track on SHA_STEAL; ZARA (not an uploader) publishes her own
  // private track whose imeta points at LUNA's sha.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-steal-victim`,
    visibility: "private", imetaSha: SHA_STEAL,
  });
  await insertMusicEvent({
    kind: 31683, pubkey: ZARA.pubkey, slug: `${SLUG}-steal`,
    visibility: "private", imetaSha: SHA_STEAL,
  });

  // Space-scoped AND private: members of the space are NOT widened in; only
  // the author and p-tag grantees see it.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-both`,
    hTag: SPACE_ID, visibility: "private", imetaSha: SHA_BOTH,
    pTags: [["p", SAGE.pubkey, "", "collaborator"]],
  });

  // Track shared into the NIP-29-native group only.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-native`,
    hTag: NATIVE_GROUP, imetaSha: SHA_NATIVE,
  });

  // Unknown visibility value: protected everywhere (never exposed by accident).
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-oddvis`,
    visibility: "members-only" as "private", imetaSha: SHA_ODDVIS,
  });

  // Private track carrying the project MEMBER roles mobile writes: contributor
  // and editor must unlock media exactly like collaborator; featured stays a credit.
  await insertMusicEvent({
    kind: 31683, pubkey: LUNA.pubkey, slug: `${SLUG}-members`,
    visibility: "private", imetaSha: SHA_MEMBERS,
    pTags: [
      ["p", DECKARD.pubkey, "", "contributor"],
      ["p", JAYDEE.pubkey, "", "editor"],
      ["p", SAGE.pubkey, "", "featured"],
    ],
  });
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG);
  for (const sha of [SHA_SPACE, SHA_GRIEF, SHA_MIXED, SHA_ROLES, SHA_MULTI, SHA_MEMBERS, SHA_SPACE_GRANT, SHA_STEAL, SHA_BOTH, SHA_NATIVE, SHA_ODDVIS]) {
    await rm(join(BLOB_DIR, sha), { force: true }).catch(() => {});
  }
  await db.execute(sql`DELETE FROM relay.groups WHERE group_id = ${NATIVE_GROUP}`);
  for (const sha of [SHA_SPACE, SHA_MULTI, SHA_MEMBERS, SHA_SPACE_GRANT]) {
    await rm(join(BLOB_DIR, "hls", sha), { recursive: true, force: true }).catch(() => {});
  }
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

describe("p-tag grants on space-scoped tracks (WIR-76)", () => {
  const url = (path: string) => `${path}/${LUNA.pubkey}/${SLUG}-space-grant`;
  const as = (pk: string | null) => (pk ? { "x-auth-pubkey": pk } : {});

  it("a non-member collaborator resolves, mints, and plays like a member", async () => {
    const resolve = await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: as(JAYDEE.pubkey) });
    expect(resolve.statusCode).toBe(200);

    const access = await server.inject({ method: "GET", url: url("/music/access"), headers: as(JAYDEE.pubkey) });
    expect(access.statusCode).toBe(200);
    const d = access.json().data;
    expect(d.gated).toBe(true);

    expect((await server.inject({ method: "GET", url: `/${SHA_SPACE_GRANT}`, headers: as(JAYDEE.pubkey) })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: `/${SHA_SPACE_GRANT}?tk=${d.token}` })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: `/hls/${SHA_SPACE_GRANT}/master.m3u8?tk=${d.token}` })).statusCode).toBe(200);

    const insights = await server.inject({ method: "GET", url: `/music/insights/31683:${LUNA.pubkey}:${SLUG}-space-grant`, headers: as(JAYDEE.pubkey) });
    expect(insights.statusCode).toBe(200);
  });

  it("a space member without a p-tag still has access", async () => {
    expect((await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: as(MARCUS.pubkey) })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: `/${SHA_SPACE_GRANT}`, headers: as(MARCUS.pubkey) })).statusCode).toBe(200);
  });

  it("a featured-only non-member, a stranger, and anon are denied on every layer", async () => {
    for (const viewer of [SAGE.pubkey, ZARA.pubkey, null]) {
      expect((await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: as(viewer) })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: url("/music/access"), headers: as(viewer) })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: `/${SHA_SPACE_GRANT}`, headers: as(viewer) })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: `/hls/${SHA_SPACE_GRANT}/master.m3u8`, headers: as(viewer) })).statusCode).toBe(404);
    }
  });
});

describe("/music/access mints only for a sha the blob layer would serve", () => {
  it("refuses a token to an author whose own private track points at someone else's protected sha", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/music/access/${ZARA.pubkey}/${SLUG}-steal`,
      headers: { "x-auth-pubkey": ZARA.pubkey },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("tk=");
    // And the blob itself stays closed to her.
    expect((await server.inject({ method: "GET", url: `/${SHA_STEAL}`, headers: { "x-auth-pubkey": ZARA.pubkey } })).statusCode).toBe(404);
  });

  it("still mints for the real owner", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/music/access/${LUNA.pubkey}/${SLUG}-steal-victim`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.gated).toBe(true);
  });
});

describe("space-scoped AND private: the space does not widen a private event", () => {
  const url = (path: string) => `${path}/${LUNA.pubkey}/${SLUG}-both`;
  const as = (pk: string | null) => (pk ? { "x-auth-pubkey": pk } : {});

  it("denies a space member without a p-tag on every layer", async () => {
    expect((await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: as(MARCUS.pubkey) })).statusCode).toBe(404);
    expect((await server.inject({ method: "GET", url: url("/music/access"), headers: as(MARCUS.pubkey) })).statusCode).toBe(404);
    expect((await server.inject({ method: "GET", url: `/${SHA_BOTH}`, headers: as(MARCUS.pubkey) })).statusCode).toBe(404);
  });

  it("serves the author and a collaborator grantee", async () => {
    for (const viewer of [LUNA.pubkey, SAGE.pubkey]) {
      expect((await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: as(viewer) })).statusCode).toBe(200);
      expect((await server.inject({ method: "GET", url: `/${SHA_BOTH}`, headers: as(viewer) })).statusCode).toBe(200);
    }
  });
});

describe("NIP-29-native group membership (relay.group_members) counts on every layer", () => {
  const url = (path: string) => `${path}/${LUNA.pubkey}/${SLUG}-native`;
  const as = (pk: string | null) => (pk ? { "x-auth-pubkey": pk } : {});

  it("a relay-native member resolves, mints, and fetches the blob", async () => {
    expect((await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: as(DECKARD.pubkey) })).statusCode).toBe(200);
    const access = await server.inject({ method: "GET", url: url("/music/access"), headers: as(DECKARD.pubkey) });
    expect(access.statusCode).toBe(200);
    expect(access.json().data.gated).toBe(true);
    expect((await server.inject({ method: "GET", url: `/${SHA_NATIVE}`, headers: as(DECKARD.pubkey) })).statusCode).toBe(200);
  });

  it("a non-member and anon are denied", async () => {
    for (const viewer of [ZARA.pubkey, null]) {
      expect((await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: as(viewer) })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: `/${SHA_NATIVE}`, headers: as(viewer) })).statusCode).toBe(404);
    }
  });
});

describe("an unknown visibility value is protected, not public", () => {
  const url = (path: string) => `${path}/${LUNA.pubkey}/${SLUG}-oddvis`;
  it("404s resolve + access for a stranger and anon, serves the author", async () => {
    for (const viewer of [ZARA.pubkey, null]) {
      const h = viewer ? { "x-auth-pubkey": viewer } : {};
      expect((await server.inject({ method: "GET", url: url("/music/resolve/track"), headers: h })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: url("/music/access"), headers: h })).statusCode).toBe(404);
      expect((await server.inject({ method: "GET", url: `/${SHA_ODDVIS}`, headers: h })).statusCode).toBe(404);
    }
    const owner = await server.inject({ method: "GET", url: url("/music/access"), headers: { "x-auth-pubkey": LUNA.pubkey } });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().data.gated).toBe(true);
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

  // Member roles: every layer (resolve, /music/access mint, raw blob via
  // NIP-98, HLS master via the minted token) must treat contributor and editor
  // exactly like collaborator.
  async function expectMemberAccess(viewer: string) {
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/resolve/track/${LUNA.pubkey}/${SLUG}-members`,
        headers: { "x-auth-pubkey": viewer },
      })).statusCode,
    ).toBe(200);

    const access = await server.inject({
      method: "GET",
      url: `/music/access/${LUNA.pubkey}/${SLUG}-members`,
      headers: { "x-auth-pubkey": viewer },
    });
    expect(access.statusCode).toBe(200);
    const d = access.json().data;
    expect(d.gated).toBe(true);

    expect(
      (await server.inject({
        method: "GET", url: `/${SHA_MEMBERS}`, headers: { "x-auth-pubkey": viewer },
      })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: "GET", url: `/${SHA_MEMBERS}?tk=${d.token}` })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_MEMBERS}/master.m3u8?tk=${d.token}` }))
        .statusCode,
    ).toBe(200);
  }

  async function expectNoAccess(viewer: string | null) {
    const headers = viewer ? { "x-auth-pubkey": viewer } : {};
    expect(
      (await server.inject({
        method: "GET", url: `/music/resolve/track/${LUNA.pubkey}/${SLUG}-members`, headers,
      })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({
        method: "GET", url: `/music/access/${LUNA.pubkey}/${SLUG}-members`, headers,
      })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: `/${SHA_MEMBERS}`, headers })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_MEMBERS}/master.m3u8`, headers }))
        .statusCode,
    ).toBe(404);
  }

  it("grants a contributor on every layer", async () => {
    await expectMemberAccess(DECKARD.pubkey);
  });

  it("grants an editor on every layer", async () => {
    await expectMemberAccess(JAYDEE.pubkey);
  });

  it("still denies a featured-only credit, an untagged viewer, and anon", async () => {
    await expectNoAccess(SAGE.pubkey);
    await expectNoAccess(ZARA.pubkey);
    await expectNoAccess(null);
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

describe("multi-space h tags", () => {
  // The track lists SPACE_ID first and SPACE_B second. SAGE is a member of
  // SPACE_B only — any-of semantics must let them through on every layer.
  it("resolves, mints, and serves blob + HLS for a member of the second space only", async () => {
    const resolved = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/${SLUG}-multi`,
      headers: { "x-auth-pubkey": SAGE.pubkey },
    });
    expect(resolved.statusCode).toBe(200);

    const access = await server.inject({
      method: "GET",
      url: `/music/access/${LUNA.pubkey}/${SLUG}-multi`,
      headers: { "x-auth-pubkey": SAGE.pubkey },
    });
    expect(access.statusCode).toBe(200);
    const d = access.json().data;
    expect(d.gated).toBe(true);

    expect(
      (await server.inject({ method: "GET", url: `/${SHA_MULTI}?tk=${d.token}` })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_MULTI}/master.m3u8?tk=${d.token}` }))
        .statusCode,
    ).toBe(200);

    // The blob layer's own membership check (NIP-98 pubkey, no token).
    expect(
      (await server.inject({
        method: "GET", url: `/${SHA_MULTI}`, headers: { "x-auth-pubkey": SAGE.pubkey },
      })).statusCode,
    ).toBe(200);
  });

  it("still serves a member of the first space", async () => {
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/resolve/track/${LUNA.pubkey}/${SLUG}-multi`,
        headers: { "x-auth-pubkey": MARCUS.pubkey },
      })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({
        method: "GET", url: `/${SHA_MULTI}`, headers: { "x-auth-pubkey": MARCUS.pubkey },
      })).statusCode,
    ).toBe(200);
  });

  it("denies a viewer who is in neither space", async () => {
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/resolve/track/${LUNA.pubkey}/${SLUG}-multi`,
        headers: { "x-auth-pubkey": ZARA.pubkey },
      })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({
        method: "GET",
        url: `/music/access/${LUNA.pubkey}/${SLUG}-multi`,
        headers: { "x-auth-pubkey": ZARA.pubkey },
      })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({
        method: "GET", url: `/${SHA_MULTI}`, headers: { "x-auth-pubkey": ZARA.pubkey },
      })).statusCode,
    ).toBe(404);
  });

  it("denies anonymous access to the blob and HLS ladder", async () => {
    expect((await server.inject({ method: "GET", url: `/${SHA_MULTI}` })).statusCode).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_MULTI}/master.m3u8` })).statusCode,
    ).toBe(404);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_MULTI}/128k/seg_00000.m4s` }))
        .statusCode,
    ).toBe(404);
  });
});
