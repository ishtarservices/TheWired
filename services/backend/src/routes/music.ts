import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { musicService } from "../services/musicService.js";
import { db } from "../db/connection.js";
import { eq, and, sql } from "drizzle-orm";
import { savedAlbumVersions } from "../db/schema/savedVersions.js";
import { spaceMembers } from "../db/schema/members.js";
import { musicUploads } from "../db/schema/music.js";
import { config } from "../config.js";
import { getTranscodeQueue } from "../lib/queue.js";
import { validate, hexId, nonEmptyString, limitParam, offsetParam } from "../lib/validation.js";

const pubkeySlugParams = z.object({
  pubkey: hexId,
  slug: nonEmptyString,
});

const uploadsQuery = z.object({
  limit: limitParam(20, 100).optional(),
  offset: offsetParam.optional(),
});

const popularTagsQuery = z.object({
  limit: limitParam(20, 100).optional(),
});

const browseQuery = z.object({
  genre: z.string().max(200).optional(),
  tag: z.string().max(200).optional(),
  sort: z.enum(["trending", "recent", "plays"]).optional(),
  limit: limitParam(20, 100),
  offset: offsetParam,
});

const browseAlbumsQuery = z.object({
  genre: z.string().max(200).optional(),
  tag: z.string().max(200).optional(),
  sort: z.enum(["trending", "recent", "plays"]).optional(),
  limit: limitParam(20, 100),
  offset: offsetParam,
});

const playBody = z.object({
  trackId: nonEmptyString,
});

const saveVersionBody = z.object({
  addressableId: nonEmptyString,
  eventId: hexId,
  createdAt: z.number().int().min(1),
});

const acknowledgeUpdateBody = z.object({
  addressableId: nonEmptyString,
  eventId: hexId,
  createdAt: z.number().int().min(1),
});

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

/** Check visibility tags and enforce access control. Returns error reply if denied, undefined if allowed. */
async function checkEventVisibility(
  event: RelayEvent,
  ownerPubkey: string,
  authPubkey: string | null,
  reply: import("fastify").FastifyReply,
): Promise<boolean> {
  const eventTags = event.tags;
  const vis = eventTags.find((t: string[]) => t[0] === "visibility")?.[1];
  const hTag = eventTags.find((t: string[]) => t[0] === "h")?.[1];

  // Space-scoped: require membership or ownership
  if (hTag) {
    if (!authPubkey) {
      reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
      return false;
    }
    if (authPubkey !== ownerPubkey) {
      const membership = await db
        .select()
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, hTag), eq(spaceMembers.pubkey, authPubkey)))
        .limit(1);
      if (membership.length === 0) {
        reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
        return false;
      }
    }
  }

  // Private/unlisted: require ownership or collaborator status
  if (vis === "unlisted" || vis === "private") {
    if (!authPubkey) {
      reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
      return false;
    }
    const isCollaborator = eventTags.some(
      (t: string[]) => t[0] === "p" && t[1] === authPubkey,
    );
    if (authPubkey !== ownerPubkey && !isCollaborator) {
      reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
      return false;
    }
  }

  return true;
}

export const musicRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/resolve/album/:pubkey/:slug -- Resolve album by addressable ID
  server.get<{ Params: { pubkey: string; slug: string } }>(
    "/resolve/album/:pubkey/:slug",
    async (request, reply) => {
      const params = validate(pubkeySlugParams, request.params, reply);
      if (!params) return;

      const { pubkey, slug } = params;

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

      // Enforce visibility access control
      const authPubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
      const allowed = await checkEventVisibility(rows[0], pubkey, authPubkey, reply);
      if (!allowed) return;

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
      const params = validate(pubkeySlugParams, request.params, reply);
      if (!params) return;

      const { pubkey, slug } = params;

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

      // Enforce visibility access control
      const authPubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
      const allowed = await checkEventVisibility(rows[0], pubkey, authPubkey, reply);
      if (!allowed) return;

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

    const query = validate(uploadsQuery, request.query, reply);
    if (!query) return;

    const rows = await musicService.listUploads(pubkey, { limit: query.limit, offset: query.offset });
    return { data: rows };
  });

  // POST /music/rebuild-counts -- Rebuild genre/tag counts from scratch.
  // Requires authentication to prevent abuse (expensive operation).
  server.post("/rebuild-counts", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }
    const result = await musicService.rebuildCounts();
    return { data: result };
  });

  // GET /music/genres -- Genre list with track counts
  server.get("/genres", async () => {
    const genres = await musicService.getGenreCounts();
    return { data: genres };
  });

  // GET /music/tags/popular -- Top hashtags
  server.get("/tags/popular", async (request, reply) => {
    const query = validate(popularTagsQuery, request.query, reply);
    if (!query) return;

    const tags = await musicService.getPopularTags(query.limit ?? 20);
    return { data: tags };
  });

  // GET /music/browse -- Filtered browse
  server.get("/browse", async (request, reply) => {
    const query = validate(browseQuery, request.query, reply);
    if (!query) return;

    const results = await musicService.browse({
      genre: query.genre,
      tag: query.tag,
      sort: query.sort ?? "trending",
      limit: query.limit,
      offset: query.offset,
    });
    // Defensive filter: ensure no private/space content in browse results
    const isPublicEvent = (r: any) => {
      const tags: string[][] = r?.tags ?? [];
      const vis = tags.find((t: string[]) => t[0] === "visibility")?.[1];
      const hTag = tags.find((t: string[]) => t[0] === "h")?.[1];
      return !vis && !hTag;
    };
    results.tracks = results.tracks.filter(isPublicEvent);
    return { data: results };
  });

  // GET /music/browse/albums -- Filtered album browse
  server.get("/browse/albums", async (request, reply) => {
    const query = validate(browseAlbumsQuery, request.query, reply);
    if (!query) return;

    const results = await musicService.browseAlbums({
      genre: query.genre,
      tag: query.tag,
      sort: query.sort ?? "recent",
      limit: query.limit,
      offset: query.offset,
    });
    // Defensive filter: ensure no private/space content in album browse results
    const isPublicEvent = (r: any) => {
      const tags: string[][] = r?.tags ?? [];
      const vis = tags.find((t: string[]) => t[0] === "visibility")?.[1];
      const hTag = tags.find((t: string[]) => t[0] === "h")?.[1];
      return !vis && !hTag;
    };
    results.albums = results.albums.filter(isPublicEvent);
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

    const body = validate(playBody, request.body, reply);
    if (!body) return;

    const recorded = await musicService.recordPlay(body.trackId, pubkey);
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
      const params = validate(pubkeySlugParams, request.params, reply);
      if (!params) return;

      const { pubkey, slug } = params;
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
      const params = validate(pubkeySlugParams, request.params, reply);
      if (!params) return;

      const { pubkey, slug } = params;
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

  // POST /music/save-version -- fan saves their current version
  server.post("/save-version", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }
    const body = validate(saveVersionBody, request.body, reply);
    if (!body) return;

    const { addressableId, eventId, createdAt } = body;

    await db
      .insert(savedAlbumVersions)
      .values({
        pubkey,
        addressableId,
        savedEventId: eventId,
        savedCreatedAt: createdAt,
        hasUpdate: false,
      })
      .onConflictDoUpdate({
        target: [savedAlbumVersions.pubkey, savedAlbumVersions.addressableId],
        set: {
          savedEventId: eventId,
          savedCreatedAt: createdAt,
          hasUpdate: false,
        },
      });

    return { data: { saved: true } };
  });

  // GET /music/saved-updates -- albums with updates available
  server.get("/saved-updates", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const rows = await db
      .select()
      .from(savedAlbumVersions)
      .where(and(
        eq(savedAlbumVersions.pubkey, pubkey),
        eq(savedAlbumVersions.hasUpdate, true),
      ));

    return { data: rows };
  });

  // POST /music/acknowledge-update -- mark update as seen
  server.post("/acknowledge-update", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }
    const body = validate(acknowledgeUpdateBody, request.body, reply);
    if (!body) return;

    const { addressableId, eventId, createdAt } = body;

    await db
      .update(savedAlbumVersions)
      .set({
        hasUpdate: false,
        savedEventId: eventId,
        savedCreatedAt: createdAt,
      })
      .where(and(
        eq(savedAlbumVersions.pubkey, pubkey),
        eq(savedAlbumVersions.addressableId, addressableId),
      ));

    return { data: { acknowledged: true } };
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

  // GET /music/variants/:sha -- Lookup transcode variants by blob sha256.
  // Client calls this at play-time using the imeta `x` hash to discover HLS
  // URLs for old events that were published before transcoding existed.
  server.get<{ Params: { sha: string } }>(
    "/variants/:sha",
    async (request, reply) => {
      const { sha } = request.params;
      if (!/^[0-9a-f]{64}$/.test(sha)) {
        return reply.status(400).send({ error: "Invalid sha256", code: "BAD_REQUEST" });
      }

      // Prefer the most-advanced row when multiple music_uploads share a sha
      // (e.g. two users uploaded the same file, or a retry created a duplicate).
      // All rows for a sha point at the same on-disk blob and HLS output, so
      // if any row is `ready`, the client should get HLS.
      const [row] = await db
        .select({
          status: musicUploads.transcodeStatus,
          hlsMasterPath: musicUploads.hlsMasterPath,
          loudnessI: musicUploads.loudnessI,
        })
        .from(musicUploads)
        .where(eq(musicUploads.sha256, sha))
        .orderBy(sql`CASE ${musicUploads.transcodeStatus}
                       WHEN 'ready'      THEN 0
                       WHEN 'processing' THEN 1
                       WHEN 'pending'    THEN 2
                       WHEN 'failed'     THEN 3
                       ELSE 4 END`)
        .limit(1);

      if (!row) return { data: { status: "unknown" as const } };

      if (row.status === "ready" && row.hlsMasterPath) {
        return {
          data: {
            status: "ready" as const,
            hlsMaster: `${config.publicUrl}/${row.hlsMasterPath}`,
            loudnessI: row.loudnessI,
          },
        };
      }

      return { data: { status: row.status } };
    },
  );

  // POST /music/admin/transcode-backfill -- Enqueue pending transcodes.
  // Admin-gated (comma-separated hex pubkeys in ADMIN_PUBKEYS). Batched;
  // re-run until `enqueued === 0`.
  server.post("/admin/transcode-backfill", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey || !config.adminPubkeys.includes(pubkey)) {
      return reply.status(403).send({ error: "Admin only", code: "FORBIDDEN" });
    }

    const rows = await db
      .select({
        sha256: musicUploads.sha256,
        storagePath: musicUploads.storagePath,
        mimeType: musicUploads.mimeType,
      })
      .from(musicUploads)
      .where(
        and(
          eq(musicUploads.transcodeStatus, "pending"),
          eq(musicUploads.status, "active"),
        ),
      )
      .limit(1000);

    const queue = getTranscodeQueue();
    let enqueued = 0;
    for (const row of rows) {
      await queue.add(
        "transcode",
        { sha256: row.sha256, mimeType: row.mimeType, storagePath: row.storagePath },
        { jobId: row.sha256 },
      );
      enqueued++;
    }

    return { data: { enqueued, batchSize: rows.length } };
  });
};
