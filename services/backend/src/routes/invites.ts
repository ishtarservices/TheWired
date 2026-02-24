import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { invites } from "../db/schema/invites.js";
import { eq } from "drizzle-orm";
import { nanoid } from "../lib/id.js";
import { permissionService } from "../services/permissionService.js";

export const invitesRoutes: FastifyPluginAsync = async (server) => {
  server.post("/", async (request, reply) => {
    const { spaceId, maxUses, expiresInHours, label, autoAssignRole } = request.body as {
      spaceId: string;
      maxUses?: number;
      expiresInHours?: number;
      label?: string;
      autoAssignRole?: string;
    };
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const perm = await permissionService.check(spaceId, pubkey, "CREATE_INVITES");
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    const code = nanoid(8);
    const expiresAt = expiresInHours ? Date.now() + expiresInHours * 3600 * 1000 : null;

    await db.insert(invites).values({
      code,
      spaceId,
      createdBy: pubkey,
      maxUses: maxUses ?? null,
      expiresAt,
      label: label ?? null,
      autoAssignRole: autoAssignRole ?? null,
    });

    return { data: { code } };
  });

  server.get<{ Params: { code: string } }>("/:code", async (request, reply) => {
    const { code } = request.params;
    const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
    if (!invite || invite.revoked) {
      return reply.status(404).send({ error: "Invite not found", code: "NOT_FOUND" });
    }
    return { data: invite };
  });

  server.delete<{ Params: { id: string } }>("/:id", async (request) => {
    const { id } = request.params;
    await db.update(invites).set({ revoked: true }).where(eq(invites.code, id));
    return { data: { success: true } };
  });
};
