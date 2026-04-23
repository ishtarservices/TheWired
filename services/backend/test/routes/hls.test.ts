import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { musicUploads } from "../../src/db/schema/music.js";
import { blobs, blobOwners } from "../../src/db/schema/blobs.js";
import { config } from "../../src/config.js";
import { nanoid } from "../../src/lib/id.js";

let server: FastifyInstance;
const BLOB_DIR = resolve(process.cwd(), config.blobDir);
const SHA_READY = "a".repeat(64);
const SHA_PENDING = "b".repeat(64);
const AUTHOR = "c".repeat(64);

beforeAll(async () => {
  server = await buildTestServer();

  // HLS files on disk survive between tests; the global setup.ts truncates
  // app.* tables per-test but not the filesystem.
  await mkdir(join(BLOB_DIR, "hls", SHA_READY), { recursive: true });
  await writeFile(
    join(BLOB_DIR, "hls", SHA_READY, "master.m3u8"),
    "#EXTM3U\n#EXT-X-VERSION:7\n128k/index.m3u8\n",
    "utf8",
  );
  await mkdir(join(BLOB_DIR, "hls", SHA_READY, "128k"), { recursive: true });
  await writeFile(
    join(BLOB_DIR, "hls", SHA_READY, "128k", "index.m3u8"),
    "#EXTM3U\n#EXT-X-TARGETDURATION:6\n",
    "utf8",
  );
  await writeFile(
    join(BLOB_DIR, "hls", SHA_READY, "128k", "seg_00000.m4s"),
    Buffer.alloc(8),
  );
});

// Re-seed DB rows before each test — the global setup.ts truncates
// `app.*` between tests.
beforeEach(async () => {
  await db.insert(blobs).values({
    sha256: SHA_READY,
    size: 100,
    type: "audio/wav",
    uploaded: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing();
  await db.insert(blobOwners).values({ sha256: SHA_READY, pubkey: AUTHOR }).onConflictDoNothing();
  await db.insert(musicUploads).values({
    id: nanoid(16),
    pubkey: AUTHOR,
    originalFilename: "ready.wav",
    storagePath: join(BLOB_DIR, `${SHA_READY}.wav`),
    url: `http://localhost/${SHA_READY}.wav`,
    sha256: SHA_READY,
    mimeType: "audio/wav",
    fileSize: 100,
    transcodeStatus: "ready",
    hlsMasterPath: `hls/${SHA_READY}/master.m3u8`,
    transcodedAt: new Date(),
  });

  await db.insert(blobs).values({
    sha256: SHA_PENDING,
    size: 100,
    type: "audio/wav",
    uploaded: Math.floor(Date.now() / 1000),
  }).onConflictDoNothing();
  await db.insert(blobOwners).values({ sha256: SHA_PENDING, pubkey: AUTHOR }).onConflictDoNothing();
  await db.insert(musicUploads).values({
    id: nanoid(16),
    pubkey: AUTHOR,
    originalFilename: "pending.wav",
    storagePath: join(BLOB_DIR, `${SHA_PENDING}.wav`),
    url: `http://localhost/${SHA_PENDING}.wav`,
    sha256: SHA_PENDING,
    mimeType: "audio/wav",
    fileSize: 100,
    transcodeStatus: "pending",
  });
});

afterAll(async () => {
  await rm(join(BLOB_DIR, "hls", SHA_READY), { recursive: true, force: true }).catch(() => {});
  await rm(join(BLOB_DIR, "hls", SHA_PENDING), { recursive: true, force: true }).catch(() => {});
  await closeTestServer();
});

describe("GET /hls/:sha/master.m3u8", () => {
  it("serves the master playlist when transcode_status=ready", async () => {
    const res = await server.inject({ method: "GET", url: `/hls/${SHA_READY}/master.m3u8` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.apple.mpegurl");
    expect(res.headers["cache-control"]).toContain("max-age=60");
    expect(res.payload).toContain("#EXTM3U");
  });

  it("returns 404 when transcode_status=pending (not ready yet)", async () => {
    const res = await server.inject({ method: "GET", url: `/hls/${SHA_PENDING}/master.m3u8` });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for an unknown sha", async () => {
    const res = await server.inject({ method: "GET", url: `/hls/${"d".repeat(64)}/master.m3u8` });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for a malformed sha", async () => {
    const res = await server.inject({ method: "GET", url: `/hls/not-a-sha/master.m3u8` });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /hls/:sha/:rendition/:file", () => {
  it("serves m4s segments with immutable cache headers", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hls/${SHA_READY}/128k/seg_00000.m4s`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["cache-control"]).toContain("max-age=31536000");
  });

  it("serves index.m3u8 with short cache", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hls/${SHA_READY}/128k/index.m3u8`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=60");
  });

  it("rejects unknown rendition names", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hls/${SHA_READY}/512k/seg_00000.m4s`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects path-traversal attempts in the segment name", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hls/${SHA_READY}/128k/..%2F..%2Fetc%2Fpasswd`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects arbitrary filenames that aren't segments or init.mp4", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hls/${SHA_READY}/128k/playlist.txt`,
    });
    expect(res.statusCode).toBe(404);
  });
});
