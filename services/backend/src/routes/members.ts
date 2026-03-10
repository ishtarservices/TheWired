import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { spaceMembers, memberRoles, spaceFeedSources } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
import { eq, and } from "drizzle-orm";

export const membersRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { id: string } }>("/:id/members", async (request) => {
    const { id } = request.params;
    const members = await db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, id));
    return { data: members };
  });

  /** DELETE /:id/members/me — Leave a space (removes the authenticated user's membership) */
  server.delete<{ Params: { id: string } }>("/:id/members/me", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const { id } = request.params;

    // Remove membership and any role assignments
    await db
      .delete(memberRoles)
      .where(and(eq(memberRoles.spaceId, id), eq(memberRoles.pubkey, pubkey)));
    await db
      .delete(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.pubkey, pubkey)));

    return { data: { left: true } };
  });

  // ── Feed Sources ──────────────────────────────────────────────────

  /** GET /:id/feed-sources — List curated feed source pubkeys */
  server.get<{ Params: { id: string } }>("/:id/feed-sources", async (request) => {
    const { id } = request.params;
    const rows = await db
      .select()
      .from(spaceFeedSources)
      .where(eq(spaceFeedSources.spaceId, id));
    return { data: rows.map((r) => r.pubkey) };
  });

  /** POST /:id/feed-sources — Add feed source pubkeys (admin only) */
  server.post<{ Params: { id: string } }>("/:id/feed-sources", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const { id } = request.params;
    const body = request.body as { pubkeys?: string[] };
    if (!Array.isArray(body?.pubkeys) || body.pubkeys.length === 0) {
      return reply.status(400).send({ error: "pubkeys array required", code: "BAD_REQUEST" });
    }

    // Verify caller is space creator or admin
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
    if (!space) return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    if (space.creatorPubkey !== pubkey) {
      return reply.status(403).send({ error: "Only the space creator can manage feed sources", code: "FORBIDDEN" });
    }

    // Insert feed sources (ignore duplicates)
    for (const pk of body.pubkeys) {
      await db
        .insert(spaceFeedSources)
        .values({ spaceId: id, pubkey: pk })
        .onConflictDoNothing();
    }

    // Return updated list
    const rows = await db
      .select()
      .from(spaceFeedSources)
      .where(eq(spaceFeedSources.spaceId, id));
    return { data: rows.map((r) => r.pubkey) };
  });

  /** DELETE /:id/feed-sources/:pubkey — Remove a feed source (admin only) */
  server.delete<{ Params: { id: string; pubkey: string } }>("/:id/feed-sources/:pubkey", async (request, reply) => {
    const callerPubkey = (request as any).pubkey as string | undefined;
    if (!callerPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const { id, pubkey: targetPubkey } = request.params;

    // Verify caller is space creator
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
    if (!space) return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    if (space.creatorPubkey !== callerPubkey) {
      return reply.status(403).send({ error: "Only the space creator can manage feed sources", code: "FORBIDDEN" });
    }

    await db
      .delete(spaceFeedSources)
      .where(and(eq(spaceFeedSources.spaceId, id), eq(spaceFeedSources.pubkey, targetPubkey)));

    return { data: { removed: true } };
  });
};
