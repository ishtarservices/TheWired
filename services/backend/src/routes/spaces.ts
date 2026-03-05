import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { spaces, spaceTags } from "../db/schema/spaces.js";
import { spaceMembers } from "../db/schema/members.js";
import { eq, inArray } from "drizzle-orm";
import { roleService } from "../services/roleService.js";
import { channelService } from "../services/channelService.js";

export const spacesRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: { limit?: string; offset?: string } }>("/", async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? "50", 10) || 50, 100);
    const offset = parseInt(request.query.offset ?? "0", 10) || 0;

    const results = await db.select().from(spaces).limit(limit).offset(offset);
    return { data: results, meta: { limit, offset } };
  });

  server.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
    if (!space) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }
    const tags = await db.select().from(spaceTags).where(eq(spaceTags.spaceId, id));
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

    const body = request.body as {
      id: string;
      name: string;
      hostRelay: string;
      picture?: string;
      about?: string;
      category?: string;
      language?: string;
      mode?: "read" | "read-write";
    };

    if (!body.id || !body.name || !body.hostRelay) {
      return reply.status(400).send({ error: "Missing required fields: id, name, hostRelay", code: "BAD_REQUEST" });
    }

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

    // Step 3: Seed default roles (idempotent — skips if roles already exist)
    const existingRoles = await roleService.listRoles(body.id);
    if (existingRoles.length === 0) {
      await roleService.seedDefaultRoles(body.id, pubkey);
    }

    // Step 4: Seed default channels (idempotent — listChannels auto-seeds)
    await channelService.listChannels(body.id);

    return { data: { id: body.id } };
  });

  /** DELETE /:id — Delete a space (admin only). CASCADE FKs handle related records. */
  server.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const { id } = request.params;

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
    const body = request.body as { ids?: string[] };
    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
      return reply.status(400).send({ error: "ids array required", code: "BAD_REQUEST" });
    }

    // Cap at 100 to prevent abuse
    const ids = body.ids.slice(0, 100);

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
