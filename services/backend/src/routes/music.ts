import type { FastifyPluginAsync } from "fastify";
import { musicService } from "../services/musicService.js";
import { db } from "../db/connection.js";
import { sql } from "drizzle-orm";

interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number | string;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Normalize PG bigint fields to JS numbers for JSON serialization */
function normalizeEvent(row: RelayEvent): RelayEvent {
  return { ...row, created_at: Number(row.created_at) };
}

export const musicRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/resolve/album/:pubkey/:slug -- Resolve album by addressable ID
  server.get<{ Params: { pubkey: string; slug: string } }>(
    "/resolve/album/:pubkey/:slug",
    async (request, reply) => {
      const { pubkey, slug } = request.params;

      const rows = (await db.execute(
        sql`SELECT id, pubkey, created_at, kind, tags, content, sig
            FROM relay.events
            WHERE kind = 33123
              AND pubkey = ${pubkey}
              AND tags @> ${JSON.stringify([["d", slug]])}::jsonb
            ORDER BY created_at DESC
            LIMIT 1`,
      )) as unknown as RelayEvent[];

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Album not found", code: "NOT_FOUND" });
      }

      const albumEvent = normalizeEvent(rows[0]);

      // Batch-fetch associated track events from album's a-tags
      const trackRefs = albumEvent.tags
        .filter((t) => t[0] === "a" && t[1]?.startsWith("31683:"))
        .map((t) => t[1]);

      const trackEvents: RelayEvent[] = [];
      for (const ref of trackRefs) {
        const [, tPubkey, dTag] = ref.split(":");
        if (!tPubkey || !dTag) continue;
        const tRows = (await db.execute(
          sql`SELECT id, pubkey, created_at, kind, tags, content, sig
              FROM relay.events
              WHERE kind = 31683
                AND pubkey = ${tPubkey}
                AND tags @> ${JSON.stringify([["d", dTag]])}::jsonb
              ORDER BY created_at DESC
              LIMIT 1`,
        )) as unknown as RelayEvent[];
        if (tRows.length > 0) trackEvents.push(normalizeEvent(tRows[0]));
      }

      return { data: { event: albumEvent, tracks: trackEvents } };
    },
  );

  // GET /music/resolve/track/:pubkey/:slug -- Resolve track by addressable ID
  server.get<{ Params: { pubkey: string; slug: string } }>(
    "/resolve/track/:pubkey/:slug",
    async (request, reply) => {
      const { pubkey, slug } = request.params;

      const rows = (await db.execute(
        sql`SELECT id, pubkey, created_at, kind, tags, content, sig
            FROM relay.events
            WHERE kind = 31683
              AND pubkey = ${pubkey}
              AND tags @> ${JSON.stringify([["d", slug]])}::jsonb
            ORDER BY created_at DESC
            LIMIT 1`,
      )) as unknown as RelayEvent[];

      if (rows.length === 0) {
        return reply.status(404).send({ error: "Track not found", code: "NOT_FOUND" });
      }

      return { data: { event: normalizeEvent(rows[0]) } };
    },
  );
  // POST /music/upload -- Upload audio file
  server.post("/upload", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded", code: "NO_FILE" });
    }

    const result = await musicService.uploadAudio(data, pubkey);
    return { data: result };
  });

  // GET /music/uploads -- List user's uploads
  server.get("/uploads", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const query = request.query as { limit?: string; offset?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;

    const rows = await musicService.listUploads(pubkey, { limit, offset });
    return { data: rows };
  });

  // POST /music/rebuild-counts -- Rebuild genre/tag counts from scratch.
  // No auth required — this is an internal endpoint only reachable on the backend port.
  // External access goes through the gateway which won't expose this route.
  server.post("/rebuild-counts", async () => {
    const result = await musicService.rebuildCounts();
    return { data: result };
  });

  // GET /music/genres -- Genre list with track counts
  server.get("/genres", async () => {
    const genres = await musicService.getGenreCounts();
    return { data: genres };
  });

  // GET /music/tags/popular -- Top hashtags
  server.get("/tags/popular", async (request) => {
    const { limit } = request.query as { limit?: string };
    const tags = await musicService.getPopularTags(limit ? parseInt(limit, 10) : 20);
    return { data: tags };
  });

  // GET /music/browse -- Filtered browse
  server.get("/browse", async (request) => {
    const { genre, tag, sort, limit, offset } = request.query as {
      genre?: string;
      tag?: string;
      sort?: string;
      limit?: string;
      offset?: string;
    };
    const results = await musicService.browse({
      genre,
      tag,
      sort: (sort as "trending" | "recent" | "plays") ?? "trending",
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    return { data: results };
  });

  // GET /music/underground -- TODO: Phase 4
  server.get("/underground", async () => {
    return { data: [] };
  });

  // GET /music/recommended -- TODO: Phase 5
  server.get("/recommended", async () => {
    return { data: [] };
  });

  // POST /music/play -- Record a play
  server.post("/play", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const { trackId } = request.body as { trackId?: string };
    if (!trackId) {
      return reply.status(400).send({ error: "trackId required", code: "BAD_REQUEST" });
    }

    const recorded = await musicService.recordPlay(trackId, pubkey);
    return { data: { recorded } };
  });

  // DELETE /music/track/:pubkey/:slug -- Delete a track (owner only)
  server.delete<{ Params: { pubkey: string; slug: string } }>(
    "/track/:pubkey/:slug",
    async (request, reply) => {
      const authPubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
      if (!authPubkey) {
        return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
      }
      const { pubkey, slug } = request.params;
      if (authPubkey !== pubkey) {
        return reply.status(403).send({ error: "Can only delete your own content", code: "FORBIDDEN" });
      }
      const deleted = await musicService.deleteMusic(31683, pubkey, slug);
      if (!deleted) {
        return reply.status(404).send({ error: "Track not found", code: "NOT_FOUND" });
      }
      return { data: { deleted: true } };
    },
  );

  // DELETE /music/album/:pubkey/:slug -- Delete an album (owner only)
  server.delete<{ Params: { pubkey: string; slug: string } }>(
    "/album/:pubkey/:slug",
    async (request, reply) => {
      const authPubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
      if (!authPubkey) {
        return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
      }
      const { pubkey, slug } = request.params;
      if (authPubkey !== pubkey) {
        return reply.status(403).send({ error: "Can only delete your own content", code: "FORBIDDEN" });
      }
      const deleted = await musicService.deleteMusic(33123, pubkey, slug);
      if (!deleted) {
        return reply.status(404).send({ error: "Album not found", code: "NOT_FOUND" });
      }
      return { data: { deleted: true } };
    },
  );

  // POST /music/upload/cover -- Upload cover art
  server.post("/upload/cover", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: "No file uploaded", code: "NO_FILE" });
    }

    const result = await musicService.uploadCover(data, pubkey);
    return { data: result };
  });
};
