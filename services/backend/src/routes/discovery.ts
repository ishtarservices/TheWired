import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { discoveryService } from "../services/discoveryService.js";
import { validate, nonEmptyString, limitParam, offsetParam } from "../lib/validation.js";
import { requirePubkey, requireSpaceCreator } from "../lib/authz.js";

const spacesQuerySchema = z.object({
  category: z.string().optional(),
  /** One tag or a comma-separated OR-list (`tag=club,techno,rave`) — a scene spans several. */
  tag: z.string().max(500).optional(),
  sort: z.enum(["trending", "newest", "popular"]).optional(),
  search: z.string().optional(),
  limit: limitParam(20, 100),
  offset: offsetParam,
});

const spaceMusicQuerySchema = z.object({
  sort: z.enum(["recent", "trending"]).optional(),
  limit: limitParam(20, 100),
});

const listingRequestBodySchema = z.object({
  spaceId: nonEmptyString,
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

const idParamsSchema = z.object({
  id: nonEmptyString,
});

const reviewBodySchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().optional(),
});

const relaysQuerySchema = z.object({
  sort: z.enum(["popular", "fastest", "newest"]).optional(),
  nip: z.coerce.number().int().optional(),
  search: z.string().optional(),
  limit: limitParam(20, 100),
});

export const discoveryRoutes: FastifyPluginAsync = async (server) => {
  // ── Space discovery ──────────────────────────────────────────────

  server.get<{
    Querystring: {
      category?: string;
      tag?: string;
      sort?: "trending" | "newest" | "popular";
      search?: string;
      limit?: string;
      offset?: string;
    };
  }>("/spaces", async (request, reply) => {
    const query = validate(spacesQuerySchema, request.query, reply);
    if (!query) return;

    const results = await discoveryService.getListedSpaces({
      category: query.category,
      tag: query.tag,
      sort: query.sort,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
    return { data: results };
  });

  server.get("/spaces/featured", async () => {
    const results = await discoveryService.getFeaturedSpaces();
    return { data: results };
  });

  // GET /discovery/spaces/music — music arriving through listed spaces.
  // Guest-readable (no NIP-98): mobile browses explore signed out.
  server.get<{
    Querystring: { sort?: "recent" | "trending"; limit?: string };
  }>("/spaces/music", async (request, reply) => {
    const query = validate(spaceMusicQuerySchema, request.query, reply);
    if (!query) return;

    const results = await discoveryService.getListedSpaceMusic({
      sort: query.sort ?? "recent",
      limit: query.limit,
    });

    // Defensive filter, mirroring /music/browse: the service already restricts
    // to h_tag/visibility NULL in SQL, but a public discovery rail is exactly
    // where a missed gate becomes a leak, so re-check the tags themselves.
    const isPublicEvent = (r: { tags?: string[][] }) => {
      const tags: string[][] = r?.tags ?? [];
      return !tags.some((t) => t[0] === "visibility" || t[0] === "h");
    };

    return {
      data: {
        tracks: results.tracks.filter(isPublicEvent),
        albums: results.albums.filter(isPublicEvent),
      },
    };
  });

  // ── Categories & scenes ─────────────────────────────────────────

  server.get("/categories", async () => {
    const categories = await discoveryService.getCategories();
    return { data: categories };
  });

  // GET /discovery/scenes — the music-first browse vocabulary. Guest-readable.
  server.get("/scenes", async () => {
    const scenes = await discoveryService.getScenes();
    return { data: scenes };
  });

  // ── Listing requests ────────────────────────────────────────────

  server.post<{
    Body: {
      spaceId: string;
      category?: string;
      tags?: string[];
      reason?: string;
    };
  }>("/listing-requests", async (request, reply) => {
    const body = validate(listingRequestBodySchema, request.body, reply);
    if (!body) return;

    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;

    // Closes #102: only the space's creator (or MANAGE_SPACE holder / platform
    // admin) may request listing. Prevents force-listing someone else's space and
    // the pending-request griefing vector.
    if (!(await requireSpaceCreator(body.spaceId, pubkey, reply, { allowPlatformAdmin: true }))) return;

    try {
      const result = await discoveryService.submitListingRequest({
        spaceId: body.spaceId,
        requesterPubkey: pubkey,
        category: body.category,
        tags: body.tags,
        reason: body.reason,
      });
      return { data: result };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  server.get("/listing-requests", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const results = await discoveryService.getListingRequests(pubkey);
    return { data: results };
  });

  server.patch<{
    Params: { id: string };
    Body: {
      status: "approved" | "rejected";
      reviewNote?: string;
    };
  }>("/listing-requests/:id", async (request, reply) => {
    const params = validate(idParamsSchema, request.params, reply);
    if (!params) return;
    const body = validate(reviewBodySchema, request.body, reply);
    if (!body) return;

    const pubkey = (request as any).pubkey;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    try {
      const result = await discoveryService.reviewListingRequest({
        requestId: params.id,
        reviewerPubkey: pubkey,
        status: body.status,
        reviewNote: body.reviewNote,
      });
      return { data: result };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── Relay discovery ─────────────────────────────────────────────

  server.get<{
    Querystring: {
      sort?: "popular" | "fastest" | "newest";
      nip?: string;
      search?: string;
      limit?: string;
    };
  }>("/relays", async (request, reply) => {
    const query = validate(relaysQuerySchema, request.query, reply);
    if (!query) return;

    const results = await discoveryService.getRelays({
      sort: query.sort,
      nip: query.nip,
      search: query.search,
      limit: query.limit,
    });
    return { data: results };
  });
};
