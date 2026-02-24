import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { spaces, spaceTags } from "../db/schema/spaces.js";
import { eq } from "drizzle-orm";

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
};
