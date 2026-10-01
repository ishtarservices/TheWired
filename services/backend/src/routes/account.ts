import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { validate, hexId } from "../lib/validation.js";
import { requirePubkey } from "../lib/authz.js";
import {
  accountDeletionService,
  spacesCreatedBy,
  validateVanishEvent,
} from "../services/accountDeletionService.js";

/**
 * DELETE /account — delete everything this operator holds for the caller
 * (App Store 5.1.1(v), NIP-62).
 *   NIP-98 (gateway) + the signed kind 62 in the body: a second proof of
 *   intent, because the gateway's replay guard fails open on a Redis error
 *   and this cannot be undone.
 * GET /account/deletion — the current status, for polling.
 *
 * 200 { data: { status: "complete", requestedAt, completedAt, deleted } }
 * 202 { data: { status: "pending", requestedAt, deleted } } — a step failed;
 *     the next call (or the next backend start) finishes the job.
 */
const deleteBody = z.object({
  confirm: z.literal("delete-account"),
  vanishEvent: z.object({
    id: hexId,
    pubkey: hexId,
    created_at: z.number().int(),
    kind: z.number().int(),
    tags: z.array(z.array(z.string())),
    content: z.string().max(1000),
    sig: z.string().regex(/^[0-9a-f]{128}$/),
  }),
  ownedSpaces: z.enum(["delete", "orphan"]).optional(),
});

export const accountRoutes: FastifyPluginAsync = async (server) => {
  server.delete("/", async (request, reply) => {
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;
    const body = validate(deleteBody, request.body ?? {}, reply);
    if (!body) return;

    const existing = await accountDeletionService.get(pubkey);
    const nowSec = Math.floor(Date.now() / 1000);
    const rejection = validateVanishEvent(body.vanishEvent, pubkey, nowSec, {
      // A retry of the recorded request may arrive after the 10-minute window.
      checkFreshness: !existing || existing.vanishEventId !== body.vanishEvent.id,
    });
    if (rejection) return reply.status(rejection.status).send({ error: rejection.error, code: rejection.code });

    // Ask whenever the purge is going to run and no choice is on record — also
    // on a repeat, which re-runs it when pending or carrying a newer vanish,
    // and may meet spaces created since the first request.
    const purgeRuns =
      !existing ||
      existing.status !== "complete" ||
      body.vanishEvent.created_at > existing.vanishCreatedAt;
    if (purgeRuns && !body.ownedSpaces && !existing?.ownedSpaces) {
      const owned = await spacesCreatedBy(pubkey);
      if (owned.length > 0) {
        return reply.status(409).send({
          error: "You created spaces: choose ownedSpaces \"delete\" or \"orphan\"",
          code: "OWNS_SPACES",
          spaces: owned,
        });
      }
    }

    const result = await accountDeletionService.request(pubkey, body.vanishEvent, body.ownedSpaces ?? null);
    return reply.status(result.status === "complete" ? 200 : 202).send({ data: result });
  });

  server.get("/deletion", async (request, reply) => {
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;
    const row = await accountDeletionService.get(pubkey);
    if (!row) return { data: { status: "none" } };
    return { data: accountDeletionService.outcome(row) };
  });
};
