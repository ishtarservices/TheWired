import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { spaces, spaceTags } from "../db/schema/spaces.js";
import { spaceMembers, spaceFeedSources } from "../db/schema/members.js";
import { spaceChannels } from "../db/schema/channels.js";
import { eq, inArray, asc } from "drizzle-orm";
import { roleService } from "../services/roleService.js";
import { channelService } from "../services/channelService.js";
import { validate, nonEmptyString, limitParam, offsetParam } from "../lib/validation.js";

const listQuerySchema = z.object({
  limit: limitParam(50, 100),
  offset: offsetParam,
});

const idParamsSchema = z.object({
  id: nonEmptyString,
});

const createSpaceBodySchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  hostRelay: nonEmptyString.url(),
  picture: z.string().optional(),
  about: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  mode: z.enum(["read", "read-write"]).optional(),
  channels: z.array(z.object({ type: nonEmptyString, label: nonEmptyString })).optional(),
});

const validateIdsBodySchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

export const spacesRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: { limit?: string; offset?: string } }>("/", async (request, reply) => {
    const query = validate(listQuerySchema, request.query, reply);
    if (!query) return;

    const limit = query.limit as number;
    const offset = query.offset as number;
    const results = await db.select().from(spaces).limit(limit).offset(offset);
    return { data: results, meta: { limit, offset } };
  });

  /** GET /my-spaces — Return all spaces the authenticated user is a member of,
   *  including channels and feed sources. Used as a recovery path when the
   *  client's IndexedDB cache is empty (logout/reimport, cache wipe, etc.). */
  server.get("/my-spaces", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    // Find all spaces this pubkey belongs to
    const memberships = await db.select({ spaceId: spaceMembers.spaceId })
      .from(spaceMembers)
      .where(eq(spaceMembers.pubkey, pubkey));

    if (memberships.length === 0) return { data: [] };

    const spaceIds = memberships.map((m) => m.spaceId);
    const spaceRows = await db.select().from(spaces).where(inArray(spaces.id, spaceIds));

    // Batch-load channels and feed sources for all spaces
    const channelRows = await db.select().from(spaceChannels)
      .where(inArray(spaceChannels.spaceId, spaceIds))
      .orderBy(asc(spaceChannels.position));
    const feedRows = await db.select().from(spaceFeedSources)
      .where(inArray(spaceFeedSources.spaceId, spaceIds));

    const channelsBySpace: Record<string, typeof channelRows> = {};
    for (const ch of channelRows) {
      (channelsBySpace[ch.spaceId] ??= []).push(ch);
    }
    const feedsBySpace: Record<string, string[]> = {};
    for (const f of feedRows) {
      (feedsBySpace[f.spaceId] ??= []).push(f.pubkey);
    }

    const result = spaceRows.map((s) => ({
      space: {
        id: s.id,
        name: s.name,
        picture: s.picture,
        about: s.about,
        mode: s.mode,
        hostRelay: s.hostRelay,
        creatorPubkey: s.creatorPubkey,
        memberCount: s.memberCount ?? 0,
      },
      channels: channelsBySpace[s.id] ?? [],
      feedPubkeys: feedsBySpace[s.id] ?? [],
    }));

    return { data: result };
  });

  server.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;

    const [space] = await db.select().from(spaces).where(eq(spaces.id, params.id)).limit(1);
    if (!space) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }
    const tags = await db.select().from(spaceTags).where(eq(spaceTags.spaceId, params.id));
    return { data: { ...space, tags: tags.map((t) => t.tag) } };
  });

  /**
   * POST / — Bootstrap a new space on the backend.
   * Creates the space record, seeds default channels, seeds default roles,
   * and registers the creator as a member+admin — all in one call.
   * This avoids FK issues from multi-step fire-and-forget chains.
   */
  server.post("/", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const body = validate(createSpaceBodySchema, request.body, reply);
    if (!body) return;

    const mode = body.mode === "read" ? "read" : "read-write";

    // Step 1: Upsert the space record (FK parent for everything else)
    await db
      .insert(spaces)
      .values({
        id: body.id,
        name: body.name,
        hostRelay: body.hostRelay,
        picture: body.picture ?? null,
        about: body.about ?? null,
        category: body.category ?? null,
        language: body.language ?? null,
        mode,
        creatorPubkey: pubkey,
        memberCount: 1,
        createdAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: spaces.id,
        set: {
          name: body.name,
          picture: body.picture ?? null,
          about: body.about ?? null,
          mode,
          creatorPubkey: pubkey,
        },
      });

    // Step 2: Register creator as a space member
    await db
      .insert(spaceMembers)
      .values({ spaceId: body.id, pubkey })
      .onConflictDoNothing();

    // Step 3: Seed default roles (idempotent + serialized — safe against concurrent calls)
    await roleService.seedDefaultRoles(body.id, pubkey);

    // Step 4: Seed channels
    if (body.channels) {
      // User specified which channels to create (can be empty array for no channels)
      await channelService.seedChannels(body.id, body.channels);
    } else {
      // No channels parameter — use legacy defaults (backward compat)
      await channelService.seedDefaultChannels(body.id);
    }

    return { data: { id: body.id } };
  });

  /** DELETE /:id — Delete a space (admin only). CASCADE FKs handle related records. */
  server.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;

    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const id = params.id;

    // Verify space exists
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
    if (!space) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }

    // Creator-only delete: if creator_pubkey is set, only the creator can delete.
    // For legacy spaces without a creator, fall back to MANAGE_SPACE permission.
    if (space.creatorPubkey) {
      if (pubkey !== space.creatorPubkey) {
        return reply.status(403).send({ error: "Only the space creator can delete this space", code: "CREATOR_ONLY" });
      }
    } else {
      const perms = await roleService.getEffectivePermissions(id, pubkey);
      if (!perms.includes("MANAGE_SPACE")) {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
    }

    // Delete space — CASCADE foreign keys clean up channels, members, roles, invites, tags
    await db.delete(spaces).where(eq(spaces.id, id));

    return { data: { deleted: true } };
  });

  /** POST /validate — Check which space IDs still exist (for stale cache cleanup). */
  server.post("/validate", async (request, reply) => {
    const body = validate(validateIdsBodySchema, request.body, reply);
    if (!body) return;

    const ids = body.ids;

    const rows = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(inArray(spaces.id, ids));

    const existingSet = new Set(rows.map((r) => r.id));
    const existing = ids.filter((id) => existingSet.has(id));
    const deleted = ids.filter((id) => !existingSet.has(id));

    return { data: { existing, deleted } };
  });
};
