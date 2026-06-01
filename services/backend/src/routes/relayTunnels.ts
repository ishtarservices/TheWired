import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { cloudflareTunnelService } from "../services/cloudflareTunnelService.js";
import { validate, hexId } from "../lib/validation.js";

const provisionBodySchema = z.object({
  /** base64-encoded 32-byte cloudflared connector secret, generated on-device. */
  tunnelSecret: z.string().min(1),
  /** Force delete + recreate (device lost its secret). */
  reset: z.boolean().optional(),
  /** The embedded relay's signing pubkey (stored for ops visibility). */
  relayPubkey: hexId.optional(),
});

/**
 * Named-tunnel provisioning for self-hosted embedded relays (Decentralized
 * Spaces, M7). Mounted under `/relays` → `POST /relays/tunnel/provision`. Auth is
 * the gateway's NIP-98 `X-Auth-Pubkey` (request.pubkey); the authenticated user
 * owns exactly one tunnel, with the subdomain derived from their pubkey so it
 * can't be chosen or squatted.
 */
export const relayTunnelRoutes: FastifyPluginAsync = async (server) => {
  server.post("/tunnel/provision", async (request, reply) => {
    const pubkey = (request as { pubkey?: string }).pubkey;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }
    const body = validate(provisionBodySchema, request.body, reply);
    if (!body) return;

    const result = await cloudflareTunnelService.provision(pubkey, body.tunnelSecret, {
      reset: body.reset,
      relayPubkey: body.relayPubkey,
    });
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error, code: result.code });
    }
    return {
      data: { tunnelId: result.tunnelId, hostname: result.hostname, accountTag: result.accountTag },
    };
  });
};
