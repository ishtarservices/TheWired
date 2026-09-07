import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { proposalService } from "../services/proposalService.js";
import {
  checkEventVisibility,
  fetchLatestByAddressableId,
} from "../services/musicVisibility.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";

const listParams = z.object({
  pubkey: hexId,
  slug: nonEmptyString,
});

const resolveParams = z.object({
  id: nonEmptyString,
});

const resolveBody = z.object({
  status: z.enum(["accepted", "rejected"]),
});

export const proposalRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/proposals/:pubkey/:slug -- list proposals for a project.
  // Gated by the target project's visibility exactly like GET /music/resolve/album:
  // a missing project and a project the viewer may not see both 404, so
  // proposal titles / track refs never leak past the project's own audience.
  server.get<{ Params: { pubkey: string; slug: string } }>(
    "/proposals/:pubkey/:slug",
    async (request, reply) => {
      const params = validate(listParams, request.params, reply);
      if (!params) return;

      const targetAlbum = `33123:${params.pubkey}:${params.slug}`;
      const project = await fetchLatestByAddressableId(targetAlbum);
      if (!project) {
        return reply.status(404).send({ error: "Album not found", code: "NOT_FOUND" });
      }
      const authPubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
      const allowed = await checkEventVisibility(project, params.pubkey, authPubkey, reply);
      if (!allowed) return;

      const proposals = await proposalService.getProposalsForAlbum(targetAlbum);
      return { data: proposals };
    },
  );

  // GET /music/proposals/incoming -- proposals where current user is owner
  server.get("/proposals/incoming", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }
    const proposals = await proposalService.getIncomingProposals(pubkey);
    return { data: proposals };
  });

  // POST /music/proposals/:id/resolve -- accept or reject
  server.post<{ Params: { id: string } }>(
    "/proposals/:id/resolve",
    async (request, reply) => {
      const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
      if (!pubkey) {
        return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
      }
      const params = validate(resolveParams, request.params, reply);
      if (!params) return;
      const body = validate(resolveBody, request.body, reply);
      if (!body) return;

      const result = await proposalService.resolveProposal(params.id, body.status, pubkey);
      if (result === null) {
        return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
      }
      if (result === "forbidden") {
        return reply.status(403).send({ error: "Only the album owner can resolve proposals", code: "FORBIDDEN" });
      }
      if (result === "already_resolved") {
        return reply.status(409).send({ error: "Proposal already resolved", code: "CONFLICT" });
      }
      return { data: { resolved: true } };
    },
  );
};
