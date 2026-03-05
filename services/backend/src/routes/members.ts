import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { spaceMembers, memberRoles } from "../db/schema/members.js";
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
};
