import type { FastifyPluginAsync } from "fastify";
import { permissionService } from "../services/permissionService.js";

export const permissionsRoutes: FastifyPluginAsync = async (server) => {
  server.get("/check", async (request) => {
    const { spaceId, pubkey, permission, channelId } = request.query as {
      spaceId: string;
      pubkey: string;
      permission: string;
      channelId?: string;
    };
    const result = await permissionService.check(spaceId, pubkey, permission, channelId);
    return { data: result };
  });
};
