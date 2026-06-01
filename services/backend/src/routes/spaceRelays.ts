import { z } from "zod";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { roleService } from "../services/roleService.js";
import { relayRegistrationService } from "../services/relayRegistrationService.js";
import { validate, nonEmptyString } from "../lib/validation.js";

const idParamsSchema = z.object({ id: nonEmptyString });
const relayBodySchema = z.object({ relayUrl: nonEmptyString });

/**
 * Routes for the Decentralized Spaces ingestion registry (M3). Mounted under
 * the `/spaces` prefix → `/spaces/:id/relays`. Auth is via the gateway's
 * `X-Auth-Pubkey` (request.pubkey). Managing a space's ingest relays is
 * creator-only (or MANAGE_SPACE for legacy spaces without a creator).
 */
export const spaceRelaysRoutes: FastifyPluginAsync = async (server) => {
  /** Resolve the caller's pubkey, else 401. */
  function requirePubkey(request: unknown, reply: FastifyReply): string | null {
    const pubkey = (request as { pubkey?: string }).pubkey;
    if (!pubkey) {
      reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
      return null;
    }
    return pubkey;
  }

  /** Authorize creator-or-MANAGE_SPACE; returns false (and replies) if denied. */
  async function authorizeManage(spaceId: string, pubkey: string, reply: FastifyReply): Promise<boolean> {
    const creator = await relayRegistrationService.spaceCreator(spaceId);
    if (creator === undefined) {
      reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
      return false;
    }
    if (creator) {
      if (creator !== pubkey) {
        reply.status(403).send({ error: "Only the space creator can manage relays", code: "CREATOR_ONLY" });
        return false;
      }
      return true;
    }
    const perms = await roleService.getEffectivePermissions(spaceId, pubkey);
    if (!perms.includes("MANAGE_SPACE")) {
      reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      return false;
    }
    return true;
  }

  // POST /:id/relays — register a relay for ingestion
  server.post<{ Params: { id: string } }>("/:id/relays", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;
    const body = validate(relayBodySchema, request.body, reply);
    if (!body) return;

    if (!(await authorizeManage(params.id, pubkey, reply))) return;

    const result = await relayRegistrationService.register(params.id, body.relayUrl, pubkey);
    if (!result.ok) {
      return reply.status(400).send({ error: result.error, code: result.code });
    }
    return { data: { status: result.status } };
  });

  // GET /:id/relays — list registered relays + health
  server.get<{ Params: { id: string } }>("/:id/relays", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;
    if (!(await authorizeManage(params.id, pubkey, reply))) return;
    return { data: await relayRegistrationService.list(params.id) };
  });

  // DELETE /:id/relays — remove a registered relay
  server.delete<{ Params: { id: string } }>("/:id/relays", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;
    const body = validate(relayBodySchema, request.body, reply);
    if (!body) return;
    if (!(await authorizeManage(params.id, pubkey, reply))) return;

    await relayRegistrationService.remove(params.id, body.relayUrl);
    return { data: { removed: true } };
  });
};
