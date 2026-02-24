import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { spaceMembers } from "../db/schema/members.js";
import { eq } from "drizzle-orm";

export const membersRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { id: string } }>("/:id/members", async (request) => {
    const { id } = request.params;
    const members = await db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, id));
    return { data: members };
  });
};
