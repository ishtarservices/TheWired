import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { db } from "../../src/db/connection.js";
import { blobs, blobOwners } from "../../src/db/schema/blobs.js";
import { musicUploads } from "../../src/db/schema/music.js";
import { config } from "../../src/config.js";
import { nanoid } from "../../src/lib/id.js";
import { clearBlobAccessCache } from "../../src/services/blobAccess.js";
import { LUNA, MARCUS, JAYDEE } from "../helpers/testUsers.js";

let server: FastifyInstance;
const BLOB_DIR = resolve(process.cwd(), config.blobDir);

const SHA_PRIV = "1".repeat(64); // private track blob (has a ready HLS ladder)
const SHA_PUB = "2".repeat(64); // public track blob
const SLUG_PRIV = "zeitgeist-priv";
const SLUG_PUB = "open-track-pub";
const SLUG_PRIV_NOSHA = "encrypted-priv"; // private, no plaintext imeta sha

async function insertTrackEvent(opts: {
  pubkey: string;
  slug: string;
  visibility?: string;
  imetaSha?: string;
  collaborators?: string[];
}) {
  const tags: string[][] = [["d", opts.slug], ["title", `T ${opts.slug}`], ["artist", "A"]];
  if (opts.visibility) tags.push(["visibility", opts.visibility]);
  if (opts.collaborators) for (const pk of opts.collaborators) tags.push(["p", pk, "", "collaborator"]);
  if (opts.imetaSha) {
    tags.push(["imeta", `url ${config.publicUrl}/${opts.imetaSha}.wav`, "m audio/mpeg", "duration 120"]);
  }
  const id = createHash("sha256").update(`${opts.pubkey}:31683:${opts.slug}`).digest("hex");
  await db.execute(
    sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig, visibility)
        VALUES (${id}, ${opts.pubkey}, 31683, ${JSON.stringify(tags)}::jsonb, '',
                ${Math.floor(Date.now() / 1000)}, ${"0".repeat(128)}, ${opts.visibility ?? null})
        ON CONFLICT (id) DO NOTHING`,
  );
}

/** Mint a token via the access endpoint, returning the parsed body. */
async function access(userPubkey: string | null, slug: string) {
  const res = await server.inject({
    method: "GET",
    url: `/music/access/${LUNA.pubkey}/${slug}`,
    headers: userPubkey ? { "x-auth-pubkey": userPubkey } : {},
  });
  return res;
}

beforeAll(async () => {
  server = await buildTestServer();

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS relay`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS relay.events (
      id TEXT PRIMARY KEY, pubkey TEXT NOT NULL, created_at BIGINT NOT NULL,
      kind INTEGER NOT NULL, tags JSONB NOT NULL DEFAULT '[]', content TEXT NOT NULL DEFAULT '',
      sig TEXT NOT NULL, d_tag TEXT, h_tag TEXT, visibility TEXT
    )`);
  await db.execute(sql`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS visibility TEXT`);

  // Blob files on disk (survive per-test app.* truncation).
  await writeFile(join(BLOB_DIR, SHA_PRIV), Buffer.alloc(1024, 7));
  await writeFile(join(BLOB_DIR, SHA_PUB), Buffer.alloc(1024, 9));

  // HLS ladder for the private track.
  await mkdir(join(BLOB_DIR, "hls", SHA_PRIV, "128k"), { recursive: true });
  await writeFile(
    join(BLOB_DIR, "hls", SHA_PRIV, "master.m3u8"),
    "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=160000\n128k/index.m3u8\n",
  );
  await writeFile(
    join(BLOB_DIR, "hls", SHA_PRIV, "128k", "index.m3u8"),
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6.0,\nseg_00000.m4s\n#EXT-X-ENDLIST\n',
  );
  await writeFile(join(BLOB_DIR, "hls", SHA_PRIV, "128k", "init.mp4"), Buffer.alloc(8));
  await writeFile(join(BLOB_DIR, "hls", SHA_PRIV, "128k", "seg_00000.m4s"), Buffer.alloc(8));
});

beforeEach(async () => {
  clearBlobAccessCache();

  for (const sha of [SHA_PRIV, SHA_PUB]) {
    await db.insert(blobs).values({
      sha256: sha, size: 1024, type: "audio/x-wav", uploaded: Math.floor(Date.now() / 1000),
    }).onConflictDoNothing();
    await db.insert(blobOwners).values({ sha256: sha, pubkey: LUNA.pubkey }).onConflictDoNothing();
  }

  await db.insert(musicUploads).values({
    id: nanoid(16), pubkey: LUNA.pubkey, originalFilename: "p.wav",
    storagePath: join(BLOB_DIR, SHA_PRIV), url: `${config.publicUrl}/${SHA_PRIV}`,
    sha256: SHA_PRIV, mimeType: "audio/x-wav", fileSize: 1024,
    transcodeStatus: "ready", hlsMasterPath: `hls/${SHA_PRIV}/master.m3u8`, transcodedAt: new Date(),
  });

  await insertTrackEvent({
    pubkey: LUNA.pubkey, slug: SLUG_PRIV, visibility: "private",
    imetaSha: SHA_PRIV, collaborators: [MARCUS.pubkey],
  });
  await insertTrackEvent({ pubkey: LUNA.pubkey, slug: SLUG_PUB, imetaSha: SHA_PUB });
  await insertTrackEvent({ pubkey: LUNA.pubkey, slug: SLUG_PRIV_NOSHA, visibility: "private" });
});

afterAll(async () => {
  await rm(join(BLOB_DIR, SHA_PRIV), { force: true }).catch(() => {});
  await rm(join(BLOB_DIR, SHA_PUB), { force: true }).catch(() => {});
  await rm(join(BLOB_DIR, "hls", SHA_PRIV), { recursive: true, force: true }).catch(() => {});
  await closeTestServer();
});

describe("GET /music/access", () => {
  it("mints a gated token + HLS master for the owner", async () => {
    const res = await access(LUNA.pubkey, SLUG_PRIV);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.gated).toBe(true);
    expect(d.token).toBeTruthy();
    expect(d.blobUrl).toContain(`${SHA_PRIV}?tk=`);
    expect(d.hlsMaster).toContain(`hls/${SHA_PRIV}/master.m3u8?tk=`);
  });

  it("mints a token for a tagged collaborator", async () => {
    const res = await access(MARCUS.pubkey, SLUG_PRIV);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.gated).toBe(true);
  });

  it("returns 404 for a non-collaborator", async () => {
    expect((await access(JAYDEE.pubkey, SLUG_PRIV)).statusCode).toBe(404);
  });

  it("returns 404 without auth", async () => {
    expect((await access(null, SLUG_PRIV)).statusCode).toBe(404);
  });

  it("returns gated:false for a public track (no token needed)", async () => {
    const res = await access(null, SLUG_PUB);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.gated).toBe(false);
  });

  it("returns gated:false for an authorized private track with no plaintext sha", async () => {
    const res = await access(LUNA.pubkey, SLUG_PRIV_NOSHA);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.gated).toBe(false);
  });
});

describe("blob GET token gating", () => {
  async function tokenFor(slug: string): Promise<string> {
    return (await access(LUNA.pubkey, slug)).json().data.token;
  }

  it("denies an unauthenticated, untokened request to a private blob", async () => {
    expect((await server.inject({ method: "GET", url: `/${SHA_PRIV}` })).statusCode).toBe(404);
  });

  it("serves a private blob with a valid token", async () => {
    const tk = await tokenFor(SLUG_PRIV);
    const res = await server.inject({ method: "GET", url: `/${SHA_PRIV}?tk=${tk}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("serves a private blob to an authorized NIP-98 pubkey (no token)", async () => {
    const res = await server.inject({
      method: "GET", url: `/${SHA_PRIV}`, headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a garbage / wrong token", async () => {
    expect((await server.inject({ method: "GET", url: `/${SHA_PRIV}?tk=deadbeef` })).statusCode).toBe(404);
  });

  it("serves a public blob without any token", async () => {
    const res = await server.inject({ method: "GET", url: `/${SHA_PUB}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("honors Range requests with 206 on a tokened private blob", async () => {
    const tk = await tokenFor(SLUG_PRIV);
    const res = await server.inject({
      method: "GET", url: `/${SHA_PRIV}?tk=${tk}`, headers: { range: "bytes=0-9" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 0-9/1024");
    expect(res.headers["content-length"]).toBe("10");
  });
});

describe("HLS token gating", () => {
  async function tokenFor(slug: string): Promise<string> {
    return (await access(LUNA.pubkey, slug)).json().data.token;
  }

  it("denies the master playlist without a token (privacy leak closed)", async () => {
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_PRIV}/master.m3u8` })).statusCode,
    ).toBe(404);
  });

  it("serves and tokenizes the master playlist with a valid token", async () => {
    const tk = await tokenFor(SLUG_PRIV);
    const res = await server.inject({ method: "GET", url: `/hls/${SHA_PRIV}/master.m3u8?tk=${tk}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.payload).toContain(`128k/index.m3u8?tk=${tk}`);
  });

  it("tokenizes segment + init URIs in the rendition playlist", async () => {
    const tk = await tokenFor(SLUG_PRIV);
    const res = await server.inject({
      method: "GET", url: `/hls/${SHA_PRIV}/128k/index.m3u8?tk=${tk}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(`seg_00000.m4s?tk=${tk}`);
    expect(res.payload).toContain(`URI="init.mp4?tk=${tk}"`);
  });

  it("serves a segment with a valid token, denies it without", async () => {
    const tk = await tokenFor(SLUG_PRIV);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_PRIV}/128k/seg_00000.m4s?tk=${tk}` })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ method: "GET", url: `/hls/${SHA_PRIV}/128k/seg_00000.m4s` })).statusCode,
    ).toBe(404);
  });
});
