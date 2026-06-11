import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceChannels } from "../db/schema/channels.js";
import { spaceRoles } from "../db/schema/permissions.js";
import { permissionService } from "../services/permissionService.js";
import { roleService } from "../services/roleService.js";
import { config } from "../config.js";

type SpaceRow = typeof spaces.$inferSelect;
type ChannelRow = typeof spaceChannels.$inferSelect;
type RoleRow = typeof spaceRoles.$inferSelect;

/**
 * Shared backend authorization layer.
 *
 * IMPORTANT: the gateway forwards requests with NO Authorization header straight
 * through (it only injects X-Auth-Pubkey after a successful NIP-98 verification),
 * so `request.pubkey` being undefined means the caller is ANONYMOUS — never
 * "trusted but unverified". Every mutating route must self-enforce via these
 * helpers. Each helper sends its own error response and returns null/false so
 * call sites stay one-liners.
 */

/** 401 unless the gateway verified a pubkey. Returns the pubkey or null. */
export function requirePubkey(request: FastifyRequest, reply: FastifyReply): string | null {
  const pubkey = (request as { pubkey?: string }).pubkey;
  if (!pubkey) {
    reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    return null;
  }
  return pubkey;
}

/** Load the app.spaces row; 404 (and reply) if missing. */
export async function requireSpace(spaceId: string, reply: FastifyReply): Promise<SpaceRow | null> {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) {
    reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
    return null;
  }
  return space;
}

/** True if the pubkey is a configured platform admin. */
function isPlatformAdmin(pubkey: string): boolean {
  return config.adminPubkeys?.includes(pubkey) ?? false;
}

/**
 * Creator gate with legacy fallback:
 *  - creatorPubkey set → must equal caller (else 403 CREATOR_ONLY)
 *  - creatorPubkey null (legacy rows only) → require `fallbackPermission` (default MANAGE_SPACE)
 *  - opts.allowPlatformAdmin → configured platform admins always pass
 * Returns the space row (authorized) or null (already replied).
 */
export async function requireSpaceCreator(
  spaceId: string,
  pubkey: string,
  reply: FastifyReply,
  opts?: { fallbackPermission?: string; allowPlatformAdmin?: boolean },
): Promise<SpaceRow | null> {
  const space = await requireSpace(spaceId, reply);
  if (!space) return null;

  if (opts?.allowPlatformAdmin && isPlatformAdmin(pubkey)) return space;

  if (space.creatorPubkey) {
    if (space.creatorPubkey !== pubkey) {
      reply.status(403).send({ error: "Only the space creator can perform this action", code: "CREATOR_ONLY" });
      return null;
    }
    return space;
  }

  // Legacy creator-less row — fall back to a permission.
  const perm = opts?.fallbackPermission ?? "MANAGE_SPACE";
  const perms = await roleService.getEffectivePermissions(spaceId, pubkey);
  if (!perms.includes(perm)) {
    reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  return space;
}

/** 403 (and reply) unless permissionService grants `permission` (channel-scoped when channelId given). */
export async function requireSpacePermission(
  spaceId: string,
  pubkey: string,
  permission: string,
  reply: FastifyReply,
  channelId?: string,
): Promise<boolean> {
  const result = await permissionService.check(spaceId, pubkey, permission, channelId);
  if (!result.allowed) {
    reply.status(403).send({ error: `Missing ${permission} permission`, code: "FORBIDDEN" });
    return false;
  }
  return true;
}

/**
 * Resource-belongs-to-space scoping rule. Loads the child row and 404s when it
 * does not belong to `spaceId` (404, not 403 — do not confirm the existence of
 * foreign resources). This is the defense-in-depth complement to the service-layer
 * compound `where` clauses.
 */
export async function requireChannelInSpace(
  spaceId: string,
  channelId: string,
  reply: FastifyReply,
): Promise<ChannelRow | null> {
  const [row] = await db.select().from(spaceChannels).where(eq(spaceChannels.id, channelId)).limit(1);
  if (!row || row.spaceId !== spaceId) {
    reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
    return null;
  }
  return row;
}

export async function requireRoleInSpace(
  spaceId: string,
  roleId: string,
  reply: FastifyReply,
): Promise<RoleRow | null> {
  const [row] = await db.select().from(spaceRoles).where(and(eq(spaceRoles.id, roleId), eq(spaceRoles.spaceId, spaceId))).limit(1);
  if (!row) {
    reply.status(404).send({ error: "Role not found", code: "NOT_FOUND" });
    return null;
  }
  return row;
}
