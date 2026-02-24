import type { FastifyPluginAsync } from "fastify";
import { musicService } from "../services/musicService.js";
import { db } from "../db/connection.js";
import { sql } from "drizzle-orm";

interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
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

      const albumEvent = rows[0];

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
        if (tRows.length > 0) trackEvents.push(tRows[0]);
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

      return { data: { event: rows[0] } };
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
