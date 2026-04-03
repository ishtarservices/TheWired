import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { revisionService } from "../services/revisionService.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";

const listParams = z.object({
  kind: z.coerce.number().int(),
  pubkey: hexId,
  slug: nonEmptyString,
});

const versionParams = listParams.extend({
  version: z.coerce.number().int().positive(),
});

export const revisionRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/revisions/:kind/:pubkey/:slug -- list revisions
  server.get<{ Params: { kind: string; pubkey: string; slug: string } }>(
    "/revisions/:kind/:pubkey/:slug",
    async (request, reply) => {
      const params = validate(listParams, request.params, reply);
      if (!params) return;

      const addressableId = `${params.kind}:${params.pubkey}:${params.slug}`;
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
      const params = validate(versionParams, request.params, reply);
      if (!params) return;

      const addressableId = `${params.kind}:${params.pubkey}:${params.slug}`;
      const revision = await revisionService.getRevision(addressableId, params.version);
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
