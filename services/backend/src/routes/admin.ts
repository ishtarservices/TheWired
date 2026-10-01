import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { validate, hexId } from "../lib/validation.js";
import { requireAdmin } from "../lib/authz.js";
import {
  REPORT_ACTIONS,
  REPORT_ID_PATTERN,
  reportService,
  serializeReport,
} from "../services/reportService.js";
import { liftSuspension, restoreEvent } from "../services/platformModeration.js";

/**
 * Platform admin routes (ADMIN_PUBKEYS, NIP-98). The minimum viable review
 * surface for reports — soot's in-app admin inbox and the `pnpm reports:*`
 * CLI both sit on the same service functions.
 *
 *   GET  /admin/reports?status=open|actioned|dismissed&cursor=&limit=
 *        → { data: { reports: Report[], nextCursor: string | null } }
 *   GET  /admin/reports/:id
 *        → { data: { report, target: { event?, profile?, priorReports, distinctReporters, suspended?, removed? } } }
 *   POST /admin/reports/:id/resolve  { action, note? } → { data: { report, closedSiblings } }
 *   POST /admin/suspensions/:pubkey/lift  { note? }   (reverses suspend_pubkey)
 *   POST /admin/tombstones/:eventId/restore { note? } (reverses remove_event / remove_music)
 */

const listQuery = z.object({
  status: z.enum(["open", "actioned", "dismissed"]).default("open"),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const idParams = z.object({ id: z.string().regex(REPORT_ID_PATTERN) });

const resolveBody = z.object({
  action: z.enum(REPORT_ACTIONS),
  note: z.string().max(1000).nullish(),
});

const noteBody = z.object({ note: z.string().max(1000).nullish() }).default({});

export const adminRoutes: FastifyPluginAsync = async (server) => {
  server.get("/reports", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const q = validate(listQuery, request.query, reply);
    if (!q) return;
    const page = await reportService.list({ status: q.status, cursor: q.cursor, limit: q.limit });
    if (!page) return reply.status(400).send({ error: "Invalid cursor", code: "INVALID_CURSOR" });
    return { data: { reports: page.reports.map(serializeReport), nextCursor: page.nextCursor } };
  });

  server.get("/reports/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const row = await reportService.get(params.id);
    if (!row) return reply.status(404).send({ error: "Report not found", code: "NOT_FOUND" });
    return { data: await reportService.detail(row) };
  });

  server.post("/reports/:id/resolve", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;
    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const body = validate(resolveBody, request.body ?? {}, reply);
    if (!body) return;
    const note = body.note?.trim() || null;
    const result = await reportService.resolve(params.id, body.action, admin, note);
    if (!result.ok) return reply.status(result.status).send({ error: result.error, code: result.code });
    return { data: { report: serializeReport(result.report), closedSiblings: result.siblings } };
  });

  server.post("/suspensions/:pubkey/lift", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;
    const params = validate(z.object({ pubkey: hexId }), request.params, reply);
    if (!params) return;
    const body = validate(noteBody, request.body ?? {}, reply);
    if (!body) return;
    const lifted = await liftSuspension(params.pubkey, admin, body.note?.trim() || null);
    if (!lifted) return reply.status(404).send({ error: "Not suspended", code: "NOT_SUSPENDED" });
    return { data: { lifted: true } };
  });

  server.post("/tombstones/:eventId/restore", async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;
    const params = validate(z.object({ eventId: hexId }), request.params, reply);
    if (!params) return;
    const body = validate(noteBody, request.body ?? {}, reply);
    if (!body) return;
    const result = await restoreEvent(params.eventId, admin, body.note?.trim() || null);
    if (!result.ok) {
      switch (result.code) {
        case "NOT_REMOVED":
          return reply.status(404).send({ error: "Not removed", code: result.code });
        case "NO_COPY":
          return reply.status(409).send({ error: "No copy was kept", code: result.code });
        case "RELAY_REFUSED":
          // The removal stays in force; nothing changed.
          return reply
            .status(502)
            .send({ error: `The relay did not take the event: ${result.message}`, code: result.code });
      }
    }
    return { data: { restored: true } };
  });
};
