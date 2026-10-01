import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { validate } from "../lib/validation.js";
import { REPORT_TARGET_TYPES } from "../db/schema/reports.js";
import { capNote, normalizeCategory, normalizeTarget, REPORT_NOTE_MAX } from "../lib/reports/reportInput.js";
import { hashReporterIp, reportService } from "../services/reportService.js";

/**
 * POST /reports — the report door for guests (no key) and the fallback for
 * signed-in users whose kind 1984 could not be published. Ids only: the body
 * names what is reported, never its text (unknown fields are dropped).
 *
 * Unauthenticated requests are accepted; the gateway caps them hard per IP
 * (RATE_LIMIT_REPORT_ANON_PER_HOUR) and forwards the IP in X-Client-Ip, which
 * is stored only as a keyed hash. NIP-98 requests are attributed to the pubkey.
 */
const reportBody = z.object({
  target: z.enum(REPORT_TARGET_TYPES),
  category: z.string().max(32),
  note: z.string().max(REPORT_NOTE_MAX).nullish(),
  pubkey: z.string().max(64).nullish(),
  eventId: z.string().max(64).nullish(),
  eventKind: z.number().int().min(0).max(65535).nullish(),
  coordinate: z.string().max(600).nullish(),
  wrapId: z.string().max(64).nullish(),
  roomId: z.string().max(128).nullish(),
  spaceId: z.string().max(128).nullish(),
});

export const reportsRoutes: FastifyPluginAsync = async (server) => {
  server.post("/", async (request, reply) => {
    const body = validate(reportBody, request.body, reply);
    if (!body) return;

    const target = normalizeTarget({ ...body, target: body.target, category: body.category });
    if (!target) {
      return reply.status(400).send({ error: "The report does not identify what it reports", code: "INVALID_TARGET" });
    }

    const pubkey = (request as { pubkey?: string }).pubkey ?? null;
    if (pubkey && target.targetType === "user" && target.targetPubkey === pubkey) {
      return reply.status(400).send({ error: "You cannot report yourself", code: "INVALID_TARGET" });
    }
    let ipHash: string | null = null;
    if (!pubkey) {
      const forwarded = request.headers["x-client-ip"];
      ipHash = hashReporterIp(typeof forwarded === "string" && forwarded ? forwarded : request.ip);
    }

    const { report, created } = await reportService.file({
      source: "http",
      reporterPubkey: pubkey,
      reporterIpHash: ipHash,
      ...target,
      category: normalizeCategory(body.category),
      note: capNote(body.note),
      reportEventId: null,
    });
    return reply.status(created ? 201 : 200).send({ data: { id: report.id } });
  });
};
