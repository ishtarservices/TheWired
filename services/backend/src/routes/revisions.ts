import type { FastifyPluginAsync } from "fastify";
import { revisionService } from "../services/revisionService.js";

export const revisionRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/revisions/:kind/:pubkey/:slug -- list revisions
  server.get<{ Params: { kind: string; pubkey: string; slug: string } }>(
    "/revisions/:kind/:pubkey/:slug",
    async (request) => {
      const { kind, pubkey, slug } = request.params;
      const addressableId = `${kind}:${pubkey}:${slug}`;
      const revisions = await revisionService.getRevisions(addressableId);
      return {
        data: revisions.map((r) => ({
          version: r.version,
          eventId: r.eventId,
          summary: r.summary,
          changes: r.diffJson,
          createdAt: Number(r.createdAt),
        })),
      };
    },
  );

  // GET /music/revisions/:kind/:pubkey/:slug/:version -- specific version
  server.get<{ Params: { kind: string; pubkey: string; slug: string; version: string } }>(
    "/revisions/:kind/:pubkey/:slug/:version",
    async (request, reply) => {
      const { kind, pubkey, slug, version } = request.params;
      const addressableId = `${kind}:${pubkey}:${slug}`;
      const revision = await revisionService.getRevision(addressableId, parseInt(version, 10));
      if (!revision) {
        return reply.status(404).send({ error: "Revision not found", code: "NOT_FOUND" });
      }
      return {
        data: {
          version: revision.version,
          eventId: revision.eventId,
          eventJson: revision.eventJson,
          summary: revision.summary,
          changes: revision.diffJson,
          createdAt: Number(revision.createdAt),
        },
      };
    },
  );
};
