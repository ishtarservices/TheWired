import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { revisionService } from "../services/revisionService.js";
import {
  checkEventVisibility,
  fetchLatestByAddressableId,
} from "../services/musicVisibility.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";
import type { FastifyReply, FastifyRequest } from "fastify";

const listParams = z.object({
  kind: z.coerce.number().int(),
  pubkey: hexId,
  slug: nonEmptyString,
});

const versionParams = listParams.extend({
  version: z.coerce.number().int().positive(),
});

/**
 * Revision history is gated by the CURRENT version's visibility, exactly like
 * GET /music/resolve/*: a missing project and one the viewer may not see both
 * 404 (docs/MUSIC_VISIBILITY.md). Without this, a private or space-scoped
 * track's full `eventJson` history was served to anyone holding the slug.
 * Returns false (reply already written) when the viewer is denied.
 */
async function gateByCurrentVersion(
  addressableId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const current = await fetchLatestByAddressableId(addressableId);
  if (!current) {
    reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
    return false;
  }
  const authPubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
  return checkEventVisibility(current, current.pubkey, authPubkey, reply);
}

export const revisionRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/revisions/:kind/:pubkey/:slug -- list revisions
  server.get<{ Params: { kind: string; pubkey: string; slug: string } }>(
    "/revisions/:kind/:pubkey/:slug",
    async (request, reply) => {
      const params = validate(listParams, request.params, reply);
      if (!params) return;

      const addressableId = `${params.kind}:${params.pubkey}:${params.slug}`;
      if (!(await gateByCurrentVersion(addressableId, request, reply))) return;
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
      if (!(await gateByCurrentVersion(addressableId, request, reply))) return;
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
