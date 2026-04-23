import type { FastifyPluginAsync } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { config } from "../config.js";

const BLOB_DIR = resolve(process.cwd(), config.blobDir);
const SHA_RE = /^[0-9a-f]{64}$/;
const RENDITION_RE = /^(128k|256k)$/;
const SEG_FILE_RE = /^(seg_\d{5}\.m4s|init\.mp4)$/;

function contentTypeFor(file: string): string {
  if (file.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (file.endsWith(".m4s")) return "video/iso.segment";
  if (file.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

export const hlsRoutes: FastifyPluginAsync = async (server) => {
  // GET /hls/:sha/master.m3u8 — master playlist, status-gated
  server.get<{ Params: { sha: string } }>(
    "/:sha/master.m3u8",
    async (request, reply) => {
      const { sha } = request.params;
      if (!SHA_RE.test(sha)) return reply.callNotFound();

      const [row] = await db
        .select({ status: musicUploads.transcodeStatus })
        .from(musicUploads)
        .where(eq(musicUploads.sha256, sha))
        .limit(1);
      if (!row || row.status !== "ready") return reply.callNotFound();

      const path = join(BLOB_DIR, "hls", sha, "master.m3u8");
      try { await stat(path); } catch { return reply.callNotFound(); }

      return reply
        .header("Content-Type", contentTypeFor("master.m3u8"))
        .header("Cache-Control", "public, max-age=60")
        .send(createReadStream(path));
    },
  );

  // GET /hls/:sha/:rendition/index.m3u8 — media playlist per rendition
  server.get<{ Params: { sha: string; rendition: string } }>(
    "/:sha/:rendition/index.m3u8",
    async (request, reply) => {
      const { sha, rendition } = request.params;
      if (!SHA_RE.test(sha) || !RENDITION_RE.test(rendition)) return reply.callNotFound();

      const path = join(BLOB_DIR, "hls", sha, rendition, "index.m3u8");
      try { await stat(path); } catch { return reply.callNotFound(); }

      return reply
        .header("Content-Type", contentTypeFor("index.m3u8"))
        .header("Cache-Control", "public, max-age=60")
        .send(createReadStream(path));
    },
  );

  // GET /hls/:sha/:rendition/:file — segments (*.m4s) and init.mp4
  server.get<{ Params: { sha: string; rendition: string; file: string } }>(
    "/:sha/:rendition/:file",
    async (request, reply) => {
      const { sha, rendition, file } = request.params;
      if (
        !SHA_RE.test(sha) ||
        !RENDITION_RE.test(rendition) ||
        !SEG_FILE_RE.test(file)
      ) {
        return reply.callNotFound();
      }

      const path = join(BLOB_DIR, "hls", sha, rendition, file);
      try { await stat(path); } catch { return reply.callNotFound(); }

      return reply
        .header("Content-Type", contentTypeFor(file))
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Accept-Ranges", "bytes")
        .send(createReadStream(path));
    },
  );
};
