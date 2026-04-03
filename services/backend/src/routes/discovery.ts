import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { discoveryService } from "../services/discoveryService.js";
import { validate, nonEmptyString, limitParam, offsetParam } from "../lib/validation.js";

const spacesQuerySchema = z.object({
  category: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(["trending", "newest", "popular"]).optional(),
  search: z.string().optional(),
  limit: limitParam(20, 100),
  offset: offsetParam,
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

  // ── Categories ──────────────────────────────────────────────────

  server.get("/categories", async () => {
    const categories = await discoveryService.getCategories();
    return { data: categories };
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

    const pubkey = (request as any).pubkey;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required" });
    }

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
