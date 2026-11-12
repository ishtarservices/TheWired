import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate, nonEmptyString, hexId, positiveInt, nonNegativeInt } from "../lib/validation.js";
import { db } from "../db/connection.js";
import { spaceMembers, memberRoles, spaceFeedSources } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceRoles } from "../db/schema/permissions.js";
import { spaceChannels } from "../db/schema/channels.js";
import { channelLayoutService } from "../services/channelLayoutService.js";
import { eq, and, asc } from "drizzle-orm";
import { onboardingService } from "../services/onboardingService.js";
import { profileCacheService, toMemberProfile, PROFILE_JOIN_CAP } from "../services/profileCacheService.js";
import { notifySpaceChanged } from "../services/spaceSignalService.js";
import { moderationService } from "../services/moderationService.js";
import { leaveSpace, refreshMemberCount } from "../services/membershipService.js";
import { gateSpaceRead } from "../lib/spaceReadGate.js";
import { requirePubkey, requireSpace, requireSpacePermission } from "../lib/authz.js";

const idParams = z.object({ id: nonEmptyString });
const memberListQuery = z.object({
  limit: positiveInt(1000).optional(),
  offset: nonNegativeInt.optional(),
});
const feedSourcesBody = z.object({
  pubkeys: z.array(hexId).min(1).max(100),
});
const feedSourceDeleteParams = z.object({ id: nonEmptyString, pubkey: hexId });

export const membersRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>(
    "/:id/members",
    async (request, reply) => {
      const params = validate(idParams, request.params, reply);
      if (!params) return;
      const query = validate(memberListQuery, request.query, reply);
      if (!query) return;
      const { id } = params;
      if (!(await gateSpaceRead(request, reply, id, "members"))) return;

      let membersQuery = db
        .select()
        .from(spaceMembers)
        .where(eq(spaceMembers.spaceId, id))
        .orderBy(asc(spaceMembers.joinedAt))
        .$dynamic();
      if (query.limit !== undefined) membersQuery = membersQuery.limit(query.limit);
      if (query.offset !== undefined) membersQuery = membersQuery.offset(query.offset);
      const members = await membersQuery;

      // Inline cached profiles for the first PROFILE_JOIN_CAP rows (facepiles);
      // rows beyond the cap keep profile: null.
      const profiles = await profileCacheService.getBatchProfiles(
        members.slice(0, PROFILE_JOIN_CAP).map((m) => m.pubkey),
      );
      const byPubkey = new Map(profiles.map((p) => [p.pubkey, p]));
      return {
        data: members.map((m, i) => ({
          ...m,
          profile: i < PROFILE_JOIN_CAP ? toMemberProfile(byPubkey.get(m.pubkey)) : null,
        })),
      };
    },
  );

  /** POST /:id/members/me — Join a listed space (adds the authenticated user as a member) */
  server.post<{ Params: { id: string } }>("/:id/members/me", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;

    // Space must exist and be listed (public discovery join)
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
    if (!space) return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    if (!space.listed) return reply.status(403).send({ error: "Space is not publicly listed", code: "FORBIDDEN" });
    if (await moderationService.isBanned(id, pubkey)) {
      return reply.status(403).send({ error: "You are banned from this space", code: "BANNED" });
    }

    // Insert-if-absent: a repeat or concurrent join by the same user is a
    // no-op that still returns the space, never a primary-key 500.
    const memberCount = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(spaceMembers)
        .values({ spaceId: id, pubkey })
        .onConflictDoNothing()
        .returning({ pubkey: spaceMembers.pubkey });
      if (inserted.length === 0) return null;

      const [defaultRole] = await tx
        .select({ id: spaceRoles.id })
        .from(spaceRoles)
        .where(and(eq(spaceRoles.spaceId, id), eq(spaceRoles.isDefault, true)))
        .limit(1);
      if (defaultRole) {
        await tx.insert(memberRoles).values({ spaceId: id, pubkey, roleId: defaultRole.id }).onConflictDoNothing();
      }
      return refreshMemberCount(tx, id);
    });
    if (memberCount !== null) notifySpaceChanged(id, "members");

    // Return space info + channels + feed sources for client to hydrate
    const channels = await db.select().from(spaceChannels).where(eq(spaceChannels.spaceId, id)).orderBy(asc(spaceChannels.position));
    const { categoriesBySpace, revisionBySpace } = await channelLayoutService.layoutsForSpaces([id]);

    // Feed sources for read-only spaces
    let feedPubkeys: string[] = [];
    if (space.mode === "read") {
      const sources = await db.select().from(spaceFeedSources).where(eq(spaceFeedSources.spaceId, id));
      feedPubkeys = sources.map((s) => s.pubkey);
    }

    // Check if space has onboarding enabled
    const obConfig = await onboardingService.getConfig(id);

    return {
      data: {
        space: {
          id: space.id,
          name: space.name,
          picture: space.picture,
          about: space.about,
          mode: space.mode,
          hostRelay: space.hostRelay,
          creatorPubkey: space.creatorPubkey,
          memberCount: memberCount ?? space.memberCount ?? 0,
        },
        channels,
        categories: categoriesBySpace[id] ?? [],
        layoutRevision: revisionBySpace[id] ?? 0,
        feedPubkeys,
        onboarding: obConfig?.enabled
          ? { hasOnboarding: true, requireCompletion: obConfig.requireCompletion }
          : null,
      },
    };
  });

  /** DELETE /:id/members/me — Leave a space (removes the authenticated user's membership) */
  server.delete<{ Params: { id: string } }>("/:id/members/me", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;

    const result = await leaveSpace(id, pubkey);
    if (result === "last_admin") {
      return reply.status(409).send({
        error: "You're the only admin. Make someone else an admin first, or delete the space.",
        code: "LAST_ADMIN",
      });
    }
    if (result === "left") notifySpaceChanged(id, "members");

    return { data: { left: true } };
  });

  // ── Feed Sources ──────────────────────────────────────────────────

  /** GET /:id/feed-sources — List curated feed source pubkeys */
  server.get<{ Params: { id: string } }>("/:id/feed-sources", async (request, reply) => {
    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;
    if (!(await gateSpaceRead(request, reply, id, "feed-sources"))) return;
    const rows = await db
      .select()
      .from(spaceFeedSources)
      .where(eq(spaceFeedSources.spaceId, id));
    return { data: rows.map((r) => r.pubkey) };
  });

  /**
   * POST /:id/feed-sources — Add feed source pubkeys (MANAGE_SPACE; the Admin
   * role and the creator pass through permissionService's admin bypass, the
   * same gate as PATCH /:id). Creator-only used to refuse every other admin
   * while the clients offered them the editor.
   */
  server.post<{ Params: { id: string } }>("/:id/feed-sources", async (request, reply) => {
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;

    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;
    const body = validate(feedSourcesBody, request.body, reply);
    if (!body) return;

    if (!(await requireSpace(id, reply))) return;
    if (!(await requireSpacePermission(id, pubkey, "MANAGE_SPACE", reply))) return;

    // Insert feed sources (ignore duplicates)
    for (const pk of new Set(body.pubkeys)) {
      await db
        .insert(spaceFeedSources)
        .values({ spaceId: id, pubkey: pk })
        .onConflictDoNothing();
    }

    // Return updated list
    const rows = await db
      .select()
      .from(spaceFeedSources)
      .where(eq(spaceFeedSources.spaceId, id));
    notifySpaceChanged(id, "feed");
    return { data: rows.map((r) => r.pubkey) };
  });

  /** DELETE /:id/feed-sources/:pubkey — Remove a feed source (MANAGE_SPACE, as above) */
  server.delete<{ Params: { id: string; pubkey: string } }>("/:id/feed-sources/:pubkey", async (request, reply) => {
    const callerPubkey = requirePubkey(request, reply);
    if (!callerPubkey) return;

    const params = validate(feedSourceDeleteParams, request.params, reply);
    if (!params) return;
    const { id, pubkey: targetPubkey } = params;

    if (!(await requireSpace(id, reply))) return;
    if (!(await requireSpacePermission(id, callerPubkey, "MANAGE_SPACE", reply))) return;

    const removed = await db
      .delete(spaceFeedSources)
      .where(and(eq(spaceFeedSources.spaceId, id), eq(spaceFeedSources.pubkey, targetPubkey)))
      .returning({ pubkey: spaceFeedSources.pubkey });

    if (removed.length > 0) notifySpaceChanged(id, "feed");
    return { data: { removed: true } };
  });
};
