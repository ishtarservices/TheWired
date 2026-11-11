import type { FastifyReply } from "fastify";
import { getActorRank, canManageRole, unknownPermissions, ungrantablePermissions, type ActorRank } from "./authz.js";
import { LayoutError, type CopyAuthority, type OverrideWriteGuard } from "../services/channelLayoutService.js";

/**
 * May this actor have category overrides copied onto channels (a move into a
 * category, "Sync now")? Copying rewrites other roles' permissions, so it takes
 * MANAGE_ROLES and the right to manage every role involved.
 */
export function copyAuthority(rank: ActorRank): CopyAuthority {
  return {
    mayCopy: (roles) =>
      (rank.isCreator || rank.permissions.includes("MANAGE_ROLES")) && roles.every((r) => canManageRole(rank, r)),
  };
}

export async function copyAuthorityFor(spaceId: string, pubkey: string): Promise<CopyAuthority> {
  return copyAuthority(await getActorRank(spaceId, pubkey));
}

/**
 * Override writes may only ADD allow-permissions the actor holds (same rule as
 * role editing). Allows that were already there are left alone, so re-sending
 * someone else's grant doesn't fail.
 */
export function overrideGuard(rank: ActorRank): OverrideWriteGuard {
  return {
    checkAddedAllows(perms) {
      const unknown = unknownPermissions(perms);
      if (unknown.length > 0) {
        throw new LayoutError(400, "BAD_REQUEST", `Unknown permission: ${unknown.join(", ")}`);
      }
      const ungrantable = ungrantablePermissions(rank, perms);
      if (ungrantable.length > 0) {
        throw new LayoutError(403, "FORBIDDEN", `You can't grant permissions you don't have: ${ungrantable.join(", ")}`);
      }
    },
  };
}

/** Send a LayoutError as its HTTP response; returns false for anything else. */
export function sendLayoutError(reply: FastifyReply, err: unknown): boolean {
  if (err instanceof LayoutError) {
    reply.status(err.status).send({ error: err.message, code: err.code });
    return true;
  }
  return false;
}
