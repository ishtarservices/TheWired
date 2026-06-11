import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { spaces, spaceTags } from "../db/schema/spaces.js";
import { spaceMembers, spaceFeedSources } from "../db/schema/members.js";
import { spaceChannels } from "../db/schema/channels.js";
import { eq, and, inArray, asc } from "drizzle-orm";
import { roleService } from "../services/roleService.js";
import { channelService } from "../services/channelService.js";
import { validate, nonEmptyString, limitParam, offsetParam } from "../lib/validation.js";
import { requirePubkey, requireSpaceCreator } from "../lib/authz.js";

const listQuerySchema = z.object({
  limit: limitParam(50, 100),
  offset: offsetParam,
});

const idParamsSchema = z.object({
  id: nonEmptyString,
});

const createSpaceBodySchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  hostRelay: nonEmptyString.url(),
  picture: z.string().optional(),
  about: z.string().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  mode: z.enum(["read", "read-write"]).optional(),
  channels: z.array(z.object({ type: nonEmptyString, label: nonEmptyString })).optional(),
});

const validateIdsBodySchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

export const spacesRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Querystring: { limit?: string; offset?: string } }>("/", async (request, reply) => {
    const query = validate(listQuerySchema, request.query, reply);
    if (!query) return;

    const limit = query.limit as number;
    const offset = query.offset as number;
    const results = await db.select().from(spaces).limit(limit).offset(offset);
    return { data: results, meta: { limit, offset } };
  });

  /** GET /my-spaces — Return all spaces the authenticated user is a member of,
   *  including channels and feed sources. Used as a recovery path when the
   *  client's IndexedDB cache is empty (logout/reimport, cache wipe, etc.). */
  server.get("/my-spaces", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

    // Find all spaces this pubkey belongs to
    const memberships = await db.select({ spaceId: spaceMembers.spaceId })
      .from(spaceMembers)
      .where(eq(spaceMembers.pubkey, pubkey));

    if (memberships.length === 0) return { data: [] };

    const spaceIds = memberships.map((m) => m.spaceId);
    const spaceRows = await db.select().from(spaces).where(inArray(spaces.id, spaceIds));

    // Batch-load channels and feed sources for all spaces
    const channelRows = await db.select().from(spaceChannels)
      .where(inArray(spaceChannels.spaceId, spaceIds))
      .orderBy(asc(spaceChannels.position));
    const feedRows = await db.select().from(spaceFeedSources)
      .where(inArray(spaceFeedSources.spaceId, spaceIds));

    const channelsBySpace: Record<string, typeof channelRows> = {};
    for (const ch of channelRows) {
      (channelsBySpace[ch.spaceId] ??= []).push(ch);
    }
    const feedsBySpace: Record<string, string[]> = {};
    for (const f of feedRows) {
      (feedsBySpace[f.spaceId] ??= []).push(f.pubkey);
    }

    const result = spaceRows.map((s) => ({
      space: {
        id: s.id,
        name: s.name,
        picture: s.picture,
        about: s.about,
        mode: s.mode,
        hostRelay: s.hostRelay,
        creatorPubkey: s.creatorPubkey,
        memberCount: s.memberCount ?? 0,
      },
      channels: channelsBySpace[s.id] ?? [],
      feedPubkeys: feedsBySpace[s.id] ?? [],
    }));

    return { data: result };
  });

  server.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;

    const [space] = await db.select().from(spaces).where(eq(spaces.id, params.id)).limit(1);
    if (!space) {
      return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    }
    const tags = await db.select().from(spaceTags).where(eq(spaceTags.spaceId, params.id));
    return { data: { ...space, tags: tags.map((t) => t.tag) } };
  });

  /**
   * POST / — Bootstrap a new space on the backend.
   * Creates the space record, seeds default channels, seeds default roles,
   * and registers the creator as a member+admin — all in one call.
   * This avoids FK issues from multi-step fire-and-forget chains.
   */
  server.post("/", async (request, reply) => {
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;

    const body = validate(createSpaceBodySchema, request.body, reply);
    if (!body) return;

    const mode = body.mode === "read" ? "read" : "read-write";

    // Determine create-vs-update. POST /spaces is BOTH the creation call and the
    // cache-wipe recovery call (re-register after IndexedDB loss), so the update
    // branch must stay idempotent for the original creator — but it must NEVER
    // let a non-creator claim or overwrite an existing space (#0 takeover).
    const [existing] = await db.select().from(spaces).where(eq(spaces.id, body.id)).limit(1);

    if (existing) {
      // Legacy creator-less rows are not claimable via POST (no live path creates
      // them; an operator backfills creator_pubkey by hand).
      if (!existing.creatorPubkey || existing.creatorPubkey !== pubkey) {
        return reply.status(403).send({
          error: "A space with this id already exists and is owned by someone else",
          code: "SPACE_EXISTS",
        });
      }
      // Creator re-registration: update metadata only. creatorPubkey is NEVER in
      // the set, and the where-clause re-asserts the creator guard so even an
      // upstream bug cannot flip ownership. hostRelay/category/language are managed
      // via the relay-registration flow, not here.
      await db
        .update(spaces)
        .set({ name: body.name, picture: body.picture ?? null, about: body.about ?? null, mode })
        .where(and(eq(spaces.id, body.id), eq(spaces.creatorPubkey, pubkey)));
      return { data: { id: body.id } };
    }

    // Create branch. onConflictDoNothing guards a concurrent-create race; if we
    // lost it, re-resolve ownership rules against the winner's row.
    const inserted = await db
      .insert(spaces)
      .values({
        id: body.id,
        name: body.name,
        hostRelay: body.hostRelay,
        picture: body.picture ?? null,
        about: body.about ?? null,
        category: body.category ?? null,
        language: body.language ?? null,
        mode,
        creatorPubkey: pubkey,
        memberCount: 1,
        createdAt: Date.now(),
      })
      .onConflictDoNothing({ target: spaces.id })
      .returning({ id: spaces.id });

    if (inserted.length === 0) {
      // Lost the create race — someone else just created it. Treat as the
      // existing-space branch above (their row, not ours).
      const [winner] = await db.select().from(spaces).where(eq(spaces.id, body.id)).limit(1);
      if (!winner || winner.creatorPubkey !== pubkey) {
        return reply.status(403).send({
          error: "A space with this id already exists and is owned by someone else",
          code: "SPACE_EXISTS",
        });
      }
      // We somehow are the creator of the winner row — fall through to seeding.
    }

    // Step 2: Register creator as a space member
    await db
      .insert(spaceMembers)
      .values({ spaceId: body.id, pubkey })
      .onConflictDoNothing();

    // Step 3: Seed default roles (idempotent + serialized; the verified creator only)
    await roleService.seedDefaultRoles(body.id, pubkey);

    // Step 4: Seed channels
    if (body.channels) {
      await channelService.seedChannels(body.id, body.channels);
    } else {
      await channelService.seedDefaultChannels(body.id);
    }

    return { data: { id: body.id } };
  });

  /** DELETE /:id — Delete a space (admin only). CASCADE FKs handle related records. */
  server.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;

    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;

    const id = params.id;

    // Creator-only delete (legacy creator-less spaces fall back to MANAGE_SPACE).
    if (!(await requireSpaceCreator(id, pubkey, reply))) return;

    // Delete space — CASCADE foreign keys clean up channels, members, roles, invites, tags
    await db.delete(spaces).where(eq(spaces.id, id));

    return { data: { deleted: true } };
  });

  /** POST /validate — Check which space IDs still exist (for stale cache cleanup). */
  server.post("/validate", async (request, reply) => {
    const body = validate(validateIdsBodySchema, request.body, reply);
    if (!body) return;

    const ids = body.ids;

    const rows = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(inArray(spaces.id, ids));

    const existingSet = new Set(rows.map((r) => r.id));
    const existing = ids.filter((id) => existingSet.has(id));
    const deleted = ids.filter((id) => !existingSet.has(id));

    return { data: { existing, deleted } };
  });
};
