import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { analyticsService } from "../services/analyticsService.js";
import { validate, nonEmptyString } from "../lib/validation.js";
import { requirePubkey, requireSpace, requireSpacePermission } from "../lib/authz.js";

const analyticsParams = z.object({
  id: nonEmptyString,
});

const analyticsQuery = z.object({
  period: z.enum(["1h", "6h", "24h", "7d"]).default("7d"),
});

export const analyticsRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { id: string } }>("/spaces/:id", async (request, reply) => {
    const params = validate(analyticsParams, request.params, reply);
    if (!params) return;
    const query = validate(analyticsQuery, request.query, reply);
    if (!query) return;

    // Closes #58/#74: space activity aggregates require VIEW_ANALYTICS (admins
    // bypass via the all-permissions admin role). 404 the space first so unknown
    // ids don't leak existence.
    const pubkey = requirePubkey(request, reply);
    if (!pubkey) return;
    if (!(await requireSpace(params.id, reply))) return;
    if (!(await requireSpacePermission(params.id, pubkey, "VIEW_ANALYTICS", reply))) return;

    const analytics = await analyticsService.getSpaceAnalytics(params.id, query.period);
    return { data: analytics };
  });
};
