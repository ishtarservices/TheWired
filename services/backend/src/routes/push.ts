import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pushService } from "../services/pushService.js";
import { validate, nonEmptyString } from "../lib/validation.js";

// ── Web Push (desktop) ──
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

// ── Mobile devices ──
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

const registerDeviceBody = z
  .object({
    provider: z.enum(["expo", "apns", "fcm"]),
    token: z.string().min(1).max(512),
    platform: z.enum(["ios", "android"]),
    appVersion: z.string().max(64).optional(),
    locale: z.string().max(32).optional(),
  })
  .refine((b) => b.provider !== "expo" || EXPO_TOKEN_RE.test(b.token), {
    path: ["token"],
    message: "Expo tokens look like ExponentPushToken[…]",
  });

// Body, not `/:token`: Expo tokens carry `[` `]`, and the web-push DELETE
// already takes a body — one convention for the plugin.
const unregisterDeviceBody = z.object({
  token: z.string().min(1).max(512),
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

  /** POST /push/devices — register (or re-bind) this device's token. */
  server.post("/devices", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const body = validate(registerDeviceBody, request.body, reply);
    if (!body) return;

    const result = await pushService.registerDevice({ pubkey, ...body });
    if (!result) {
      return reply.status(400).send({ error: "Too many devices", code: "TOO_MANY_DEVICES" });
    }
    return { data: { id: result.id } };
  });

  /** DELETE /push/devices — drop this device's token (own pubkey only). */
  server.delete("/devices", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const body = validate(unregisterDeviceBody, request.body, reply);
    if (!body) return;

    const removed = await pushService.unregisterDevice(pubkey, body.token);
    return { data: { removed } };
  });

  /** POST /push/suppress — DEPRECATED no-op (docs/DM_WIRE_CONTRACT.md §7.3).
   *  Self-wraps are now flagged by the relay from the publisher's NIP-42
   *  identity, so the client no longer has to tell the server which wraps it
   *  authored. Kept for one release so older mobile builds get a 200 instead
   *  of a 404; remove afterwards. Still requires auth so it can't be probed. */
  server.post("/suppress", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return { data: { success: true, deprecated: true } };
  });
};
