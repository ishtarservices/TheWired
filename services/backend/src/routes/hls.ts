import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { config } from "../config.js";
import { getProtectedRefForBlob } from "../services/blobAccess.js";
import { verifyMediaToken } from "../lib/mediaToken.js";

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

/**
 * Access decision for an HLS request. The HLS routes get NO `X-Auth-Pubkey` from the
 * gateway (media elements can't send NIP-98), so a protected ladder can only be served
 * with a valid capability token (`?tk=`). A present+valid token short-circuits the DB
 * lookup entirely (hot segment path). Public ladders are served without a token.
 */
async function checkHlsAccess(
  sha: string,
  request: FastifyRequest,
): Promise<{ ok: boolean; tokened: boolean; token?: string }> {
  const tk = (request.query as { tk?: string }).tk;
  if (tk && verifyMediaToken(sha, tk)) return { ok: true, tokened: true, token: tk };
  const protectedRef = await getProtectedRefForBlob(sha);
  if (protectedRef) return { ok: false, tokened: false }; // protected, no valid token → deny
  return { ok: true, tokened: false }; // public
}

/** Append `?tk=<token>` to every child/segment URI in a playlist so relative-URL
 *  resolution (which drops the query) doesn't strip the token. Handles bare URI lines
 *  and the quoted `#EXT-X-MAP:URI="init.mp4"` attribute; leaves comments/tags alone. */
function tokenizePlaylist(body: string, token: string): string {
  const q = `?tk=${token}`;
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === "") return line;
      if (trimmed.startsWith("#EXT-X-MAP:")) {
        return line.replace(/URI="([^"]+)"/, (_m, uri: string) => `URI="${uri}${q}"`);
      }
      if (trimmed.startsWith("#")) return line;
      return line + q;
    })
    .join("\n");
}

async function servePlaylist(
  path: string,
  access: { tokened: boolean; token?: string },
  reply: import("fastify").FastifyReply,
) {
  try {
    await stat(path);
  } catch {
    return reply.callNotFound();
  }
  let body = await readFile(path, "utf8");
  if (access.tokened && access.token) body = tokenizePlaylist(body, access.token);
  return reply
    .header("Content-Type", contentTypeFor(path))
    .header("Cache-Control", access.tokened ? "private, no-store" : "public, max-age=60")
    .send(body);
}

export const hlsRoutes: FastifyPluginAsync = async (server) => {
  // GET /hls/:sha/master.m3u8 — master playlist, status- and access-gated
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

      const access = await checkHlsAccess(sha, request);
      if (!access.ok) return reply.callNotFound();

      return servePlaylist(join(BLOB_DIR, "hls", sha, "master.m3u8"), access, reply);
    },
  );

  // GET /hls/:sha/:rendition/index.m3u8 — media playlist per rendition
  server.get<{ Params: { sha: string; rendition: string } }>(
    "/:sha/:rendition/index.m3u8",
    async (request, reply) => {
      const { sha, rendition } = request.params;
      if (!SHA_RE.test(sha) || !RENDITION_RE.test(rendition)) return reply.callNotFound();

      const access = await checkHlsAccess(sha, request);
      if (!access.ok) return reply.callNotFound();

      return servePlaylist(join(BLOB_DIR, "hls", sha, rendition, "index.m3u8"), access, reply);
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

      const access = await checkHlsAccess(sha, request);
      if (!access.ok) return reply.callNotFound();

      const path = join(BLOB_DIR, "hls", sha, rendition, file);
      try {
        await stat(path);
      } catch {
        return reply.callNotFound();
      }

      return reply
        .header("Content-Type", contentTypeFor(file))
        .header(
          "Cache-Control",
          access.tokened ? "private, no-store" : "public, max-age=31536000, immutable",
        )
        .header("Accept-Ranges", "bytes")
        .send(createReadStream(path));
    },
  );
};
