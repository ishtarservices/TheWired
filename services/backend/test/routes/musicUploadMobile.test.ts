/**
 * The mobile (soot) music contract against /music/*:
 *  - iOS reports .m4a uploads as `audio/x-m4a` — accepted as audio/mp4; an
 *    unknown type is a 400, never a 500 (also for the cover upload);
 *  - the upload answers (and stores) a duration even when the client sends none
 *    (expo's native multipart carries no probed length): ffprobe when it can
 *    read the file, else the client's field — in whole seconds (BIGINT column);
 *  - a d-tag containing "/" is addressable: the client sends
 *    encodeURIComponent(slug) and every :slug route decodes it as ONE segment
 *    (the gateway half of this lives in services/gateway proxy tests).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { musicUploads } from "../../src/db/schema/music.js";
import { blobs } from "../../src/db/schema/blobs.js";
import { config } from "../../src/config.js";
import {
  ensureRelayEventsTable,
  insertMusicEvent,
  deleteRelayEventsBySlugPrefix,
} from "../helpers/relayEvents.js";

let server: FastifyInstance;
const BLOB_DIR = join(process.cwd(), config.blobDir);
const SLUG_PREFIX = "mobile-contract-";
const createdShas = new Set<string>();

const HAS_FFPROBE = (() => {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  server = await buildTestServer();
  await ensureRelayEventsTable();
});

afterAll(async () => {
  await deleteRelayEventsBySlugPrefix(SLUG_PREFIX);
  for (const sha of createdShas) await unlink(join(BLOB_DIR, sha)).catch(() => {});
  await closeTestServer();
});

/** multipart body; `fields` go BEFORE the file part (what both clients do). */
function multipart(
  filename: string,
  contentType: string,
  data: Buffer,
  fields: Record<string, string> = {},
): { body: Buffer; boundary: string } {
  const boundary = "----MobileContract" + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
  );
  parts.push(data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

async function upload(
  contentType: string,
  data: Buffer,
  fields?: Record<string, string>,
  url = "/music/upload",
  filename = "voice memo.m4a",
) {
  const { body, boundary } = multipart(filename, contentType, data, fields);
  const res = await server.inject({
    method: "POST",
    url,
    headers: { "x-auth-pubkey": LUNA.pubkey, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  const sha = res.json()?.data?.sha256;
  if (typeof sha === "string") createdShas.add(sha);
  return res;
}

/** A valid PCM WAV: 8 kHz, 8-bit mono, `seconds` long. */
function wav(seconds: number, seed: number): Buffer {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + n, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate, 28); // byte rate
  h.writeUInt16LE(1, 32); // block align
  h.writeUInt16LE(8, 34); // bits
  h.write("data", 36);
  h.writeUInt32LE(n, 40);
  const samples = Buffer.alloc(n, 128);
  samples[0] = seed & 0xff; // unique bytes per test → unique sha
  return Buffer.concat([h, samples]);
}

function tmpFiles(): string[] {
  return existsSync(BLOB_DIR) ? readdirSync(BLOB_DIR).filter((f) => f.startsWith(".tmp_")) : [];
}

describe("POST /music/upload — content types", () => {
  it("accepts iOS's audio/x-m4a as audio/mp4 and stores the canonical type", async () => {
    const res = await upload("audio/x-m4a", Buffer.from(`fake-m4a-${Date.now()}-${"x".repeat(64)}`));
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.mimeType).toBe("audio/mp4");

    const [row] = await db.select().from(musicUploads).where(eq(musicUploads.sha256, data.sha256));
    expect(row.mimeType).toBe("audio/mp4");
    const [blob] = await db.select().from(blobs).where(eq(blobs.sha256, data.sha256));
    expect(blob.type).toBe("audio/mp4");
  });

  it("accepts mixed case and codec parameters", async () => {
    const res = await upload("Audio/MP4; codecs=mp4a.40.2", Buffer.from(`fake-params-${Date.now()}-${"y".repeat(64)}`));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.mimeType).toBe("audio/mp4");
  });

  it.each(["application/x-bogus", "video/mp4", "text/plain", "application/octet-stream"])(
    "answers %s with a 400 INVALID_AUDIO_TYPE and stores nothing",
    async (mime) => {
      const before = tmpFiles().length;
      const res = await upload(mime, Buffer.from(`not-audio-${mime}-${Date.now()}`));
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_AUDIO_TYPE");
      expect(await db.select().from(musicUploads)).toHaveLength(0);
      expect(tmpFiles().length).toBe(before);
    },
  );

  it("still answers 401 for an anonymous upload", async () => {
    const { body, boundary } = multipart("a.m4a", "audio/x-m4a", Buffer.from("anon"));
    const res = await server.inject({
      method: "POST",
      url: "/music/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("answers an unknown cover type with a 400, not a 500", async () => {
    const res = await upload("image/svg+xml", Buffer.from("<svg/>"), undefined, "/music/upload/cover", "c.svg");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_IMAGE_TYPE");
  });
});

describe("POST /music/upload — duration", () => {
  it.skipIf(!HAS_FFPROBE)("probes the duration when the client sends none (mobile)", async () => {
    const res = await upload("audio/wav", wav(2.6, 1), { title: "t", artist: "a" }, "/music/upload", "clip.wav");
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.duration).toBe(3);
    const [row] = await db.select().from(musicUploads).where(eq(musicUploads.sha256, data.sha256));
    expect(row.duration).toBe(3);
  });

  it.skipIf(!HAS_FFPROBE)("prefers the probed duration over a wrong client claim", async () => {
    const res = await upload("audio/wav", wav(1.2, 2), { duration: "999" }, "/music/upload", "clip.wav");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.duration).toBe(1);
  });

  it("falls back to a fractional client duration, rounded for the BIGINT column", async () => {
    // Unprobeable bytes: ffprobe (if present) fails, so the client field wins.
    const res = await upload("audio/mpeg", Buffer.from(`fake-mp3-${Date.now()}-${"z".repeat(64)}`), {
      duration: "183.6",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.duration).toBe(184);
    const [row] = await db.select().from(musicUploads).where(eq(musicUploads.sha256, data.sha256));
    expect(row.duration).toBe(184);
  });

  it("omits duration when neither the probe nor the client has one", async () => {
    const res = await upload("audio/mpeg", Buffer.from(`fake-mp3-none-${Date.now()}-${"w".repeat(64)}`));
    expect(res.statusCode).toBe(200);
    expect(res.json().data).not.toHaveProperty("duration");
    const [row] = await db.select().from(musicUploads).where(eq(musicUploads.sha256, res.json().data.sha256));
    expect(row.duration).toBeNull();
  });
});

describe("d-tags containing '/' (client sends encodeURIComponent(slug))", () => {
  const enc = (s: string) => encodeURIComponent(s);

  it("resolves, mints access for, and deletes a track whose d-tag has a slash", async () => {
    const slug = `${SLUG_PREFIX}ep/1`;
    await insertMusicEvent({ kind: 31683, pubkey: LUNA.pubkey, slug });

    const resolved = await server.inject({ method: "GET", url: `/music/resolve/track/${LUNA.pubkey}/${enc(slug)}` });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.event.tags).toContainEqual(["d", slug]);

    const access = await server.inject({
      method: "GET",
      url: `/music/access/${LUNA.pubkey}/${enc(slug)}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(access.statusCode).toBe(200);
    expect(access.json().data).toEqual({ gated: false });

    const del = await server.inject({
      method: "DELETE",
      url: `/music/track/${LUNA.pubkey}/${enc(slug)}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.deleted).toBe(true);

    // Gone now → the ROUTE's own 404 (with a code), which the app reads as "absent".
    const again = await server.inject({
      method: "DELETE",
      url: `/music/track/${LUNA.pubkey}/${enc(slug)}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe("NOT_FOUND");
  });

  it("resolves, lists proposals for, and deletes an album whose d-tag has slashes", async () => {
    const slug = `${SLUG_PREFIX}albums/2026/lp`;
    await insertMusicEvent({ kind: 33123, pubkey: LUNA.pubkey, slug });

    const resolved = await server.inject({ method: "GET", url: `/music/resolve/album/${LUNA.pubkey}/${enc(slug)}` });
    expect(resolved.statusCode).toBe(200);

    const proposals = await server.inject({ method: "GET", url: `/music/proposals/${LUNA.pubkey}/${enc(slug)}` });
    expect(proposals.statusCode).toBe(200);
    expect(proposals.json().data).toEqual([]);

    const forbidden = await server.inject({
      method: "DELETE",
      url: `/music/album/${LUNA.pubkey}/${enc(slug)}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(forbidden.statusCode).toBe(403);

    const del = await server.inject({
      method: "DELETE",
      url: `/music/album/${LUNA.pubkey}/${enc(slug)}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(del.statusCode).toBe(200);
  });
});
