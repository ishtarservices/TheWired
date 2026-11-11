import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate, nonEmptyString, nonNegativeInt } from "../lib/validation.js";
import { channelService } from "../services/channelService.js";
import { channelLayoutService, MAX_CATEGORIES } from "../services/channelLayoutService.js";
import { permissionService } from "../services/permissionService.js";
import { gateSpaceRead } from "../lib/spaceReadGate.js";
import { notifySpaceChanged, type SpaceChange } from "../services/spaceSignalService.js";
import { getActorRank } from "../lib/authz.js";
import { copyAuthority, copyAuthorityFor, sendLayoutError } from "../lib/layoutAuthority.js";

const spaceIdParams = z.object({ spaceId: nonEmptyString });

/** Slow mode: 0 (off) to six hours, whole seconds. */
const slowMode = nonNegativeInt.max(21_600);

/** Category ids are opaque and may carry spaces (legacy names), so never trim. */
const categoryRef = z.string().min(1).max(128);
const channelIdRef = z.string().min(1).max(128);

const createChannelBody = z.object({
  type: nonEmptyString.max(32),
  label: nonEmptyString.max(100),
  /** A category id, or (older clients) a category name; null/absent = none. */
  categoryId: z.string().max(128).nullable().optional(),
  adminOnly: z.boolean().optional(),
  slowModeSeconds: slowMode.optional(),
  temporary: z.boolean().optional(),
  feedMode: z.enum(["all", "curated"]).optional(),
});

const channelParams = z.object({ spaceId: nonEmptyString, channelId: nonEmptyString });

const updateChannelBody = z.object({
  label: nonEmptyString.max(100).optional(),
  categoryId: z.string().max(128).nullable().optional(),
  position: nonNegativeInt.max(10_000).optional(),
  adminOnly: z.boolean().optional(),
  slowModeSeconds: slowMode.optional(),
  isDefault: z.boolean().optional(),
  feedMode: z.enum(["all", "curated"]).optional(),
});

const reorderBody = z.object({
  orderedIds: z.array(z.string().max(128)).min(1).max(200),
});

const layoutBody = z.object({
  baseRevision: z.number().int().min(0),
  uncategorized: z.array(channelIdRef).max(500),
  categories: z
    .array(
      z.object({
        id: categoryRef.optional(),
        name: z.string().max(256),
        channelIds: z.array(channelIdRef).max(500),
      }),
    )
    .max(MAX_CATEGORIES),
});

export const channelsRoutes: FastifyPluginAsync = async (server) => {
  /** GET /:spaceId/channels — List channels (canonical order).
   *  VIEW_CHANNEL filtering is handled client-side via channel overrides. */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/channels",
    async (request, reply) => {
      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;

      if (!(await gateSpaceRead(request, reply, params.spaceId, "channels"))) return;
      const channels = await channelService.listChannels(params.spaceId);
      return { data: channels };
    },
  );

  /** GET /:spaceId/channels/layout — Categories + channels + revision. Same read
   *  gate as GET /channels (unlisted spaces are for members). */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/channels/layout",
    async (request, reply) => {
      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;

      if (!(await gateSpaceRead(request, reply, params.spaceId, "channels"))) return;
      const layout = await channelLayoutService.getLayout(params.spaceId);
      if (!layout) return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
      return { data: layout };
    },
  );

  /** PUT /:spaceId/channels/layout — Replace the layout (create/rename/reorder/delete
   *  categories, move/reorder channels) against `baseRevision`; 409 when stale. */
  server.put<{ Params: { spaceId: string } }>(
    "/:spaceId/channels/layout",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(layoutBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        const authority = copyAuthority(await getActorRank(params.spaceId, pubkey));
        const { layout, overridesChanged } = await channelLayoutService.putLayout(params.spaceId, body, authority);
        const changes: SpaceChange[] = overridesChanged ? ["channels", "roles"] : ["channels"];
        notifySpaceChanged(params.spaceId, changes);
        return { data: layout };
      } catch (err) {
        if (sendLayoutError(reply, err)) return;
        throw err;
      }
    },
  );

  /** POST /:spaceId/channels — Create channel */
  server.post<{ Params: { spaceId: string } }>(
    "/:spaceId/channels",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(createChannelBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        const { channel, overridesChanged } = await channelService.createChannel(params.spaceId, body);
        notifySpaceChanged(params.spaceId, overridesChanged ? ["channels", "roles"] : "channels");
        return { data: channel };
      } catch (err) {
        if (sendLayoutError(reply, err)) return;
        throw err;
      }
    },
  );

  /** PATCH /:spaceId/channels/:channelId — Update channel */
  server.patch<{ Params: { spaceId: string; channelId: string } }>(
    "/:spaceId/channels/:channelId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(channelParams, request.params, reply);
      if (!params) return;
      const body = validate(updateChannelBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        const authority = await copyAuthorityFor(params.spaceId, pubkey);
        const result = await channelService.updateChannel(params.spaceId, params.channelId, body, authority);
        if (!result) return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
        notifySpaceChanged(params.spaceId, result.overridesChanged ? ["channels", "roles"] : "channels");
        return { data: result.channel };
      } catch (err) {
        if (sendLayoutError(reply, err)) return;
        throw err;
      }
    },
  );

  /** DELETE /:spaceId/channels/:channelId — Delete channel (its overrides cascade) */
  server.delete<{ Params: { spaceId: string; channelId: string } }>(
    "/:spaceId/channels/:channelId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(channelParams, request.params, reply);
      if (!params) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        await channelService.deleteChannel(params.spaceId, params.channelId);
        notifySpaceChanged(params.spaceId, "channels");
        return { data: { success: true } };
      } catch (err) {
        if (sendLayoutError(reply, err)) return;
        throw err;
      }
    },
  );

  /** POST /:spaceId/channels/reorder — Legacy flat reorder (normalized into categories) */
  server.post<{ Params: { spaceId: string } }>(
    "/:spaceId/channels/reorder",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(reorderBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        await channelService.reorderChannels(params.spaceId, body.orderedIds);
        notifySpaceChanged(params.spaceId, "channels");
        return { data: { success: true } };
      } catch (err) {
        if (sendLayoutError(reply, err)) return;
        throw err;
      }
    },
  );

  /** POST /:spaceId/channels/:channelId/sync-permissions — Make a channel follow
   *  its category's permissions again (MANAGE_ROLES + every affected role manageable). */
  server.post<{ Params: { spaceId: string; channelId: string } }>(
    "/:spaceId/channels/:channelId/sync-permissions",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(channelParams, request.params, reply);
      if (!params) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      try {
        const authority = await copyAuthorityFor(params.spaceId, pubkey);
        const channel = await channelLayoutService.syncChannelPermissions(params.spaceId, params.channelId, authority);
        notifySpaceChanged(params.spaceId, ["channels", "roles"]);
        return { data: channel };
      } catch (err) {
        if (sendLayoutError(reply, err)) return;
        throw err;
      }
    },
  );
};
