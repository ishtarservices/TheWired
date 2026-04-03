import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate, nonEmptyString, hexId } from "../lib/validation.js";
import { db } from "../db/connection.js";
import { spaceMembers, memberRoles, spaceFeedSources } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceRoles } from "../db/schema/permissions.js";
import { spaceChannels } from "../db/schema/channels.js";
import { eq, and, sql, asc } from "drizzle-orm";
import { onboardingService } from "../services/onboardingService.js";

const idParams = z.object({ id: nonEmptyString });
const feedSourcesBody = z.object({
  pubkeys: z.array(hexId).min(1).max(100),
});
const feedSourceDeleteParams = z.object({ id: nonEmptyString, pubkey: hexId });

export const membersRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { id: string } }>("/:id/members", async (request, reply) => {
    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;
    const members = await db.select().from(spaceMembers).where(eq(spaceMembers.spaceId, id));
    return { data: members };
  });

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

    // Check if already a member
    const [existing] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.pubkey, pubkey)))
      .limit(1);
    if (existing) return reply.status(409).send({ error: "Already a member", code: "ALREADY_MEMBER" });

    // Insert member
    await db.insert(spaceMembers).values({ spaceId: id, pubkey });

    // Assign default role
    const [defaultRole] = await db
      .select({ id: spaceRoles.id })
      .from(spaceRoles)
      .where(and(eq(spaceRoles.spaceId, id), eq(spaceRoles.isDefault, true)))
      .limit(1);
    if (defaultRole) {
      await db.insert(memberRoles).values({ spaceId: id, pubkey, roleId: defaultRole.id }).onConflictDoNothing();
    }

    // Increment member count
    await db.update(spaces).set({ memberCount: sql`${spaces.memberCount} + 1` }).where(eq(spaces.id, id));

    // Return space info + channels + feed sources for client to hydrate
    const channels = await db.select().from(spaceChannels).where(eq(spaceChannels.spaceId, id)).orderBy(asc(spaceChannels.position));

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
          memberCount: (space.memberCount ?? 0) + 1,
        },
        channels,
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

    // Remove membership and any role assignments
    await db
      .delete(memberRoles)
      .where(and(eq(memberRoles.spaceId, id), eq(memberRoles.pubkey, pubkey)));
    await db
      .delete(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.pubkey, pubkey)));

    return { data: { left: true } };
  });

  // ── Feed Sources ──────────────────────────────────────────────────

  /** GET /:id/feed-sources — List curated feed source pubkeys */
  server.get<{ Params: { id: string } }>("/:id/feed-sources", async (request, reply) => {
    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;
    const rows = await db
      .select()
      .from(spaceFeedSources)
      .where(eq(spaceFeedSources.spaceId, id));
    return { data: rows.map((r) => r.pubkey) };
  });

  /** POST /:id/feed-sources — Add feed source pubkeys (admin only) */
  server.post<{ Params: { id: string } }>("/:id/feed-sources", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;
    const body = validate(feedSourcesBody, request.body, reply);
    if (!body) return;

    // Verify caller is space creator or admin
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
    if (!space) return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    if (space.creatorPubkey !== pubkey) {
      return reply.status(403).send({ error: "Only the space creator can manage feed sources", code: "FORBIDDEN" });
    }

    // Insert feed sources (ignore duplicates)
    for (const pk of body.pubkeys) {
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
    return { data: rows.map((r) => r.pubkey) };
  });

  /** DELETE /:id/feed-sources/:pubkey — Remove a feed source (admin only) */
  server.delete<{ Params: { id: string; pubkey: string } }>("/:id/feed-sources/:pubkey", async (request, reply) => {
    const callerPubkey = (request as any).pubkey as string | undefined;
    if (!callerPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    const params = validate(feedSourceDeleteParams, request.params, reply);
    if (!params) return;
    const { id, pubkey: targetPubkey } = params;

    // Verify caller is space creator
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
    if (!space) return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    if (space.creatorPubkey !== callerPubkey) {
      return reply.status(403).send({ error: "Only the space creator can manage feed sources", code: "FORBIDDEN" });
    }

    await db
      .delete(spaceFeedSources)
      .where(and(eq(spaceFeedSources.spaceId, id), eq(spaceFeedSources.pubkey, targetPubkey)));

    return { data: { removed: true } };
  });
};
