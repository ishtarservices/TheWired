import type { FastifyPluginAsync } from "fastify";
import { discoveryService } from "../services/discoveryService.js";

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
  }>("/spaces", async (request) => {
    const { category, tag, sort, search, limit, offset } = request.query;
    const results = await discoveryService.getListedSpaces({
      category,
      tag,
      sort,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
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
    const pubkey = (request as any).pubkey;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    try {
      const result = await discoveryService.submitListingRequest({
        spaceId: request.body.spaceId,
        requesterPubkey: pubkey,
        category: request.body.category,
        tags: request.body.tags,
        reason: request.body.reason,
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
    const pubkey = (request as any).pubkey;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    try {
      const result = await discoveryService.reviewListingRequest({
        requestId: request.params.id,
        reviewerPubkey: pubkey,
        status: request.body.status,
        reviewNote: request.body.reviewNote,
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
  }>("/relays", async (request) => {
    const { sort, nip, search, limit } = request.query;
    const results = await discoveryService.getRelays({
      sort,
      nip: nip ? parseInt(nip, 10) : undefined,
      search,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { data: results };
  });
};
