import type { FastifyPluginAsync } from "fastify";
import { pushService } from "../services/pushService.js";

export const pushRoutes: FastifyPluginAsync = async (server) => {
  server.post("/subscribe", async (request) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const { endpoint, keys } = request.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    await pushService.subscribe(pubkey, endpoint, keys);
    return { data: { success: true } };
  });

  server.delete("/subscribe", async (request) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const { endpoint } = request.body as { endpoint: string };
    await pushService.unsubscribe(pubkey, endpoint);
    return { data: { success: true } };
  });
};
