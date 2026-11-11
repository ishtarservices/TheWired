import type { FastifyRequest, FastifyReply } from "fastify";
import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceMembers } from "../db/schema/members.js";
import { config } from "../config.js";
import { isPlatformAdmin } from "./authz.js";

/**
 * Read gate for space-scoped data (roster, roles, channels, feed sources,
 * onboarding, full space row).
 *
 * A listed space is public. An unlisted one is invite-only, so its data is
 * for members. `SPACE_READ_GATE` (config.spaceReadGate) rolls this out:
 * `off` serves everyone, `log` serves a read the gate would refuse and logs
 * it, `enforce` refuses it. Older mobile builds read these routes unsigned,
 * so `log` stays the default until signed builds are out.
 *
 * Spaces the backend doesn't know are not gated: the routes answer for them
 * exactly as before.
 */
export async function canReadSpace(spaceId: string, pubkey: string | undefined): Promise<boolean> {
  const [space] = await db.select({ listed: spaces.listed }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space || space.listed) return true;
  if (!pubkey) return false;
  if (isPlatformAdmin(pubkey)) return true;
  const [member] = await db
    .select({ pubkey: spaceMembers.pubkey })
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)))
    .limit(1);
  return !!member;
}

const LOG_EVERY_MS = 60_000;
/** `${route}:${spaceId}` → last "would refuse" log time. Bounded. */
const lastLogged = new Map<string, number>();

function noteWouldRefuse(route: string, spaceId: string): void {
  const key = `${route}:${spaceId}`;
  const now = Date.now();
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < LOG_EVERY_MS) return;
  if (lastLogged.size >= 1000) lastLogged.delete(lastLogged.keys().next().value as string);
  lastLogged.set(key, now);
  console.warn(`[space-read-gate] log mode: served ${route} for unlisted space ${spaceId} to a non-member`);
}

/**
 * Whether this request gets the full response ("full") or the gated one
 * ("limited"). "limited" only ever comes back in enforce mode.
 */
export async function spaceReadAccess(
  request: FastifyRequest,
  spaceId: string,
  route: string,
): Promise<"full" | "limited"> {
  if (config.spaceReadGate === "off") return "full";
  const pubkey = (request as { pubkey?: string }).pubkey;
  if (await canReadSpace(spaceId, pubkey)) return "full";
  if (config.spaceReadGate === "log") {
    noteWouldRefuse(route, spaceId);
    return "full";
  }
  return "limited";
}

/**
 * Gate a space-scoped read: true to serve it, false after replying 404. A
 * 404 rather than 403 so the response doesn't confirm an unlisted space.
 */
export async function gateSpaceRead(
  request: FastifyRequest,
  reply: FastifyReply,
  spaceId: string,
  route: string,
): Promise<boolean> {
  if ((await spaceReadAccess(request, spaceId, route)) === "full") return true;
  reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
  return false;
}

/** Reset the log throttle (tests). */
export function resetSpaceReadGateLogForTests(): void {
  lastLogged.clear();
}
