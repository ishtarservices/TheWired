import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pushService } from "../services/pushService.js";
import { validate, nonEmptyString } from "../lib/validation.js";

const subscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: nonEmptyString,
    auth: nonEmptyString,
  }),
});

const unsubscribeBody = z.object({
  endpoint: z.string().url(),
});

export const pushRoutes: FastifyPluginAsync = async (server) => {
  server.post("/subscribe", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const body = validate(subscribeBody, request.body, reply);
    if (!body) return;

    await pushService.subscribe(pubkey, body.endpoint, body.keys);
    return { data: { success: true } };
  });

  server.delete("/subscribe", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const body = validate(unsubscribeBody, request.body, reply);
    if (!body) return;

    await pushService.unsubscribe(pubkey, body.endpoint);
    return { data: { success: true } };
  });
};
