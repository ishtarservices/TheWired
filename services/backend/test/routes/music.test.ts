import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, JAYDEE } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { musicUploads } from "../../src/db/schema/music.js";
import { blobs, blobOwners } from "../../src/db/schema/blobs.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { config } from "../../src/config.js";

let server: FastifyInstance;

const BLOB_DIR = join(process.cwd(), config.blobDir);

beforeAll(async () => {
  server = await buildTestServer();

  // Create the relay schema + events table used by resolve endpoints.
  // In production, the Rust relay creates this; in tests we need a minimal version.
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
      h_tag TEXT
    )
  `);
});

afterAll(async () => {
  await closeTestServer();
});

// ---- Helpers ----

/** Build a multipart/form-data body for server.inject() */
function buildMultipartPayload(
  filename: string,
  contentType: string,
  fileData: Buffer,
): { body: Buffer; boundary: string } {
  const boundary = "----TestBoundary" + Date.now();
  const parts: Buffer[] = [];

  // File part
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
  ));
  parts.push(fileData);
  parts.push(Buffer.from("\r\n"));

  // Closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(parts), boundary };
}

/** Create a deterministic audio file buffer */
function makeAudioFile(label: string): Buffer {
  // Create a buffer that's big enough to be realistic but small enough for tests
  return Buffer.from(`fake-audio-data-${label}-${"x".repeat(200)}`);
}

/** Insert a fake relay event simulating a published track */
async function insertRelayEvent(opts: {
  pubkey: string;
  slug: string;
  audioUrl: string;
  sha256: string;
  coverUrl?: string;
}) {
  const tags: string[][] = [
    ["d", opts.slug],
    ["title", `Test Track ${opts.slug}`],
    ["artist", "Test Artist"],
    ["genre", "Electronic"],
    ["imeta", `url ${opts.audioUrl}`, "m audio/mpeg", `x ${opts.sha256}`, "duration 120"],
  ];
  if (opts.coverUrl) {
    tags.push(["image", opts.coverUrl]);
  }

  const id = createHash("sha256")
    .update(`${opts.pubkey}:31683:${opts.slug}`)
    .digest("hex");

  await db.execute(
    sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig)
        VALUES (${id}, ${opts.pubkey}, 31683, ${JSON.stringify(tags)}::jsonb, '', ${Math.floor(Date.now() / 1000)}, ${"0".repeat(128)})
        ON CONFLICT (id) DO NOTHING`,
  );
}

// ---- Tests ----

describe("music upload + delete lifecycle", () => {
  it("upload creates entries in music_uploads, blobs, and blob_owners", async () => {
    const audioData = makeAudioFile("lifecycle-upload");
    const { body, boundary } = buildMultipartPayload("test-track.mp3", "audio/mpeg", audioData);

    const response = await server.inject({
      method: "POST",
      url: "/music/upload",
      headers: {
        "x-auth-pubkey": LUNA.pubkey,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const result = response.json().data;
    expect(result.sha256).toBeTruthy();
    expect(result.url).toContain(result.sha256);

    // Verify music_uploads row exists
    const [upload] = await db.select().from(musicUploads)
      .where(sql`${musicUploads.sha256} = ${result.sha256}`)
      .limit(1);
    expect(upload).toBeTruthy();
    expect(upload.pubkey).toBe(LUNA.pubkey);

    // Verify blobs row exists
    const [blob] = await db.select().from(blobs)
      .where(sql`${blobs.sha256} = ${result.sha256}`)
      .limit(1);
    expect(blob).toBeTruthy();
    expect(blob.size).toBe(audioData.length);

    // Verify blob_owners row exists
    const [owner] = await db.select().from(blobOwners)
      .where(sql`${blobOwners.sha256} = ${result.sha256} AND ${blobOwners.pubkey} = ${LUNA.pubkey}`)
      .limit(1);
    expect(owner).toBeTruthy();

    // Verify file exists on disk
    const ext = ".mp3";
    expect(existsSync(join(BLOB_DIR, `${result.sha256}${ext}`))).toBe(true);
  });

  it("delete cleans up music_uploads, blobs, blob_owners, and disk file", async () => {
    // Step 1: Upload audio
    const audioData = makeAudioFile("lifecycle-delete");
    const { body, boundary } = buildMultipartPayload("delete-me.mp3", "audio/mpeg", audioData);

    const uploadRes = await server.inject({
      method: "POST",
      url: "/music/upload",
      headers: {
        "x-auth-pubkey": LUNA.pubkey,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(uploadRes.statusCode).toBe(200);
    const { sha256, url: audioUrl } = uploadRes.json().data;

    // Step 2: Insert a fake relay event so deleteMusic() has something to delete
    const slug = "delete-test-track";
    await insertRelayEvent({
      pubkey: LUNA.pubkey,
      slug,
      audioUrl,
      sha256,
    });

    // Step 3: Delete via the music route
    const deleteRes = await server.inject({
      method: "DELETE",
      url: `/music/track/${LUNA.pubkey}/${slug}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().data.deleted).toBe(true);

    // Step 4: Verify everything is cleaned up
    const uploads = await db.select().from(musicUploads)
      .where(sql`${musicUploads.sha256} = ${sha256}`);
    expect(uploads.length).toBe(0);

    const owners = await db.select().from(blobOwners)
      .where(sql`${blobOwners.sha256} = ${sha256}`);
    expect(owners.length).toBe(0);

    const blobRows = await db.select().from(blobs)
      .where(sql`${blobs.sha256} = ${sha256}`);
    expect(blobRows.length).toBe(0);

    // File should be removed from disk
    expect(existsSync(join(BLOB_DIR, `${sha256}.mp3`))).toBe(false);
  });

  it("delete with multiple owners only removes requesting user's ownership", async () => {
    // Both Luna and Marcus upload the same file
    const audioData = makeAudioFile("lifecycle-multi-owner-delete");
    const { body, boundary } = buildMultipartPayload("shared.mp3", "audio/mpeg", audioData);

    const lunaUpload = await server.inject({
      method: "POST",
      url: "/music/upload",
      headers: {
        "x-auth-pubkey": LUNA.pubkey,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(lunaUpload.statusCode).toBe(200);
    const { sha256, url: audioUrl } = lunaUpload.json().data;

    // Marcus uploads the same bytes -- dedup means same blob, new music_uploads row + blob_owner
    const { body: body2, boundary: boundary2 } = buildMultipartPayload("shared.mp3", "audio/mpeg", audioData);
    const marcusUpload = await server.inject({
      method: "POST",
      url: "/music/upload",
      headers: {
        "x-auth-pubkey": MARCUS.pubkey,
        "content-type": `multipart/form-data; boundary=${boundary2}`,
      },
      payload: body2,
    });
    expect(marcusUpload.statusCode).toBe(200);

    // Insert relay events for both users
    const lunaSlug = "luna-shared-track";
    const marcusSlug = "marcus-shared-track";
    await insertRelayEvent({ pubkey: LUNA.pubkey, slug: lunaSlug, audioUrl, sha256 });
    await insertRelayEvent({ pubkey: MARCUS.pubkey, slug: marcusSlug, audioUrl, sha256 });

    // Luna deletes her track
    const deleteRes = await server.inject({
      method: "DELETE",
      url: `/music/track/${LUNA.pubkey}/${lunaSlug}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(deleteRes.statusCode).toBe(200);

    // Luna's music_uploads row should be gone
    const lunaUploads = await db.select().from(musicUploads)
      .where(sql`${musicUploads.sha256} = ${sha256} AND ${musicUploads.pubkey} = ${LUNA.pubkey}`);
    expect(lunaUploads.length).toBe(0);

    // Luna's blob ownership should be gone
    const lunaOwners = await db.select().from(blobOwners)
      .where(sql`${blobOwners.sha256} = ${sha256} AND ${blobOwners.pubkey} = ${LUNA.pubkey}`);
    expect(lunaOwners.length).toBe(0);

    // But blob still exists (Marcus still owns it)
    const blobRows = await db.select().from(blobs)
      .where(sql`${blobs.sha256} = ${sha256}`);
    expect(blobRows.length).toBe(1);

    // Marcus's ownership intact
    const marcusOwners = await db.select().from(blobOwners)
      .where(sql`${blobOwners.sha256} = ${sha256} AND ${blobOwners.pubkey} = ${MARCUS.pubkey}`);
    expect(marcusOwners.length).toBe(1);

    // File still on disk
    expect(existsSync(join(BLOB_DIR, `${sha256}.mp3`))).toBe(true);
  });

  it("re-upload after delete works (no orphan conflicts)", async () => {
    // Upload
    const audioData = makeAudioFile("lifecycle-reupload");
    const { body, boundary } = buildMultipartPayload("reupload.mp3", "audio/mpeg", audioData);

    const upload1 = await server.inject({
      method: "POST",
      url: "/music/upload",
      headers: {
        "x-auth-pubkey": LUNA.pubkey,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(upload1.statusCode).toBe(200);
    const { sha256, url: audioUrl } = upload1.json().data;

    // Publish + delete
    const slug = "reupload-track";
    await insertRelayEvent({ pubkey: LUNA.pubkey, slug, audioUrl, sha256 });

    const deleteRes = await server.inject({
      method: "DELETE",
      url: `/music/track/${LUNA.pubkey}/${slug}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(deleteRes.statusCode).toBe(200);

    // Re-upload the same file -- this is the scenario that was failing before
    const { body: body2, boundary: boundary2 } = buildMultipartPayload("reupload.mp3", "audio/mpeg", audioData);
    const upload2 = await server.inject({
      method: "POST",
      url: "/music/upload",
      headers: {
        "x-auth-pubkey": LUNA.pubkey,
        "content-type": `multipart/form-data; boundary=${boundary2}`,
      },
      payload: body2,
    });

    // This was the 500 error -- should now succeed
    expect(upload2.statusCode).toBe(200);
    expect(upload2.json().data.sha256).toBe(sha256);

    // Verify clean state
    const uploads = await db.select().from(musicUploads)
      .where(sql`${musicUploads.sha256} = ${sha256}`);
    expect(uploads.length).toBe(1);
  });
});

// ---- Resolve endpoint visibility tests ----

/** Insert a relay event with visibility tags */
async function insertRelayEventWithVisibility(opts: {
  pubkey: string;
  kind: number;
  slug: string;
  visibility?: string;
  hTag?: string;
  collaborators?: string[];
}) {
  const tags: string[][] = [
    ["d", opts.slug],
    ["title", `Test ${opts.slug}`],
    ["artist", "Test Artist"],
  ];
  if (opts.visibility) tags.push(["visibility", opts.visibility]);
  if (opts.hTag) tags.push(["h", opts.hTag]);
  if (opts.collaborators) {
    for (const pk of opts.collaborators) {
      tags.push(["p", pk, "", "collaborator"]);
    }
  }

  const id = createHash("sha256")
    .update(`${opts.pubkey}:${opts.kind}:${opts.slug}`)
    .digest("hex");

  await db.execute(
    sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig)
        VALUES (${id}, ${opts.pubkey}, ${opts.kind}, ${JSON.stringify(tags)}::jsonb, '', ${Math.floor(Date.now() / 1000)}, ${"0".repeat(128)})
        ON CONFLICT (id) DO NOTHING`,
  );
}

describe("resolve endpoint visibility enforcement", () => {
  it("public track is accessible without auth", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-public-track",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-public-track`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.event).toBeTruthy();
  });

  it("private track returns 404 without auth", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-private-track",
      visibility: "private",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-private-track`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("private track returns 404 for non-collaborator", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-private-track-nc",
      visibility: "private",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-private-track-nc`,
      headers: { "x-auth-pubkey": JAYDEE.pubkey },
    });
    expect(res.statusCode).toBe(404);
  });

  it("private track is accessible to the owner", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-private-track-own",
      visibility: "private",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-private-track-own`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(res.statusCode).toBe(200);
  });

  it("private track is accessible to a tagged collaborator", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-private-track-collab",
      visibility: "private",
      collaborators: [MARCUS.pubkey],
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-private-track-collab`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(res.statusCode).toBe(200);
  });

  it("unlisted (legacy) track returns 404 for non-collaborator", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-unlisted-track",
      visibility: "unlisted",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-unlisted-track`,
      headers: { "x-auth-pubkey": JAYDEE.pubkey },
    });
    expect(res.statusCode).toBe(404);
  });

  it("space-scoped track returns 404 without auth", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-space-track",
      hTag: "test-space-id",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-space-track`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("space-scoped track returns 404 for non-member", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-space-track-nm",
      hTag: "test-space-nm",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-space-track-nm`,
      headers: { "x-auth-pubkey": JAYDEE.pubkey },
    });
    expect(res.statusCode).toBe(404);
  });

  it("space-scoped track is accessible to the owner", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-space-track-own",
      hTag: "test-space-own",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-space-track-own`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(res.statusCode).toBe(200);
  });

  it("space-scoped track is accessible to a space member", async () => {
    const spaceId = "test-space-member-check";

    // Create the space and add Marcus as a member
    await db.execute(
      sql`INSERT INTO app.spaces (id, name, host_relay, created_at, mode)
          VALUES (${spaceId}, 'Test Space', 'wss://test.relay', ${Math.floor(Date.now() / 1000)}, 'read-write')
          ON CONFLICT (id) DO NOTHING`,
    );
    await db.insert(spaceMembers).values({
      spaceId,
      pubkey: MARCUS.pubkey,
    }).onConflictDoNothing();

    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 31683,
      slug: "vis-space-track-member",
      hTag: spaceId,
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/track/${LUNA.pubkey}/vis-space-track-member`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(res.statusCode).toBe(200);
  });

  // Album resolve tests
  it("private album returns 404 without auth", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 33123,
      slug: "vis-private-album",
      visibility: "private",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/album/${LUNA.pubkey}/vis-private-album`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("private album is accessible to the owner", async () => {
    await insertRelayEventWithVisibility({
      pubkey: LUNA.pubkey,
      kind: 33123,
      slug: "vis-private-album-own",
      visibility: "private",
    });

    const res = await server.inject({
      method: "GET",
      url: `/music/resolve/album/${LUNA.pubkey}/vis-private-album-own`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(res.statusCode).toBe(200);
  });
});
