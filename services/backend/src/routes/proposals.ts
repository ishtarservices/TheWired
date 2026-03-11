import type { FastifyPluginAsync } from "fastify";
import { proposalService } from "../services/proposalService.js";

export const proposalRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/proposals/:pubkey/:slug -- list proposals for a project
  server.get<{ Params: { pubkey: string; slug: string } }>(
    "/proposals/:pubkey/:slug",
    async (request) => {
      const { pubkey, slug } = request.params;
      const targetAlbum = `33123:${pubkey}:${slug}`;
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
      const { status } = request.body as { status: "accepted" | "rejected" };
      if (!["accepted", "rejected"].includes(status)) {
        return reply.status(400).send({ error: "Invalid status", code: "BAD_REQUEST" });
      }
      const result = await proposalService.resolveProposal(request.params.id, status, pubkey);
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
