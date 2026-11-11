import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate, nonEmptyString } from "../lib/validation.js";
import { db } from "../db/connection.js";
import { invites } from "../db/schema/invites.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceMembers, memberRoles } from "../db/schema/members.js";
import { spaceRoles } from "../db/schema/permissions.js";
import { eq, and, sql, or, isNull, gt, lt } from "drizzle-orm";
import { nanoid } from "../lib/id.js";
import { permissionService } from "../services/permissionService.js";
import { onboardingService } from "../services/onboardingService.js";
import { notifySpaceChanged } from "../services/spaceSignalService.js";
import { moderationService } from "../services/moderationService.js";
import { refreshMemberCount } from "../services/membershipService.js";
import { getActorRank, canManageRole, isSpaceCreator } from "../lib/authz.js";

const createInviteBody = z.object({
  spaceId: nonEmptyString,
  maxUses: z.number().int().min(1).optional(),
  expiresInHours: z.number().min(0).optional(),
  label: z.string().optional(),
  autoAssignRole: z.string().optional(),
});

const codeParams = z.object({ code: nonEmptyString });
const spaceIdParams = z.object({ spaceId: nonEmptyString });
const idParams = z.object({ id: nonEmptyString });

class RedeemRefused extends Error {
  constructor(readonly reason: "unavailable" | "already_member") {
    super(reason);
  }
}

type InviteRow = typeof invites.$inferSelect;

/**
 * Why an invite can't be redeemed right now, or null if it can. With
 * `exhaustedIfAvailable`, a row that looks available still reports
 * INVITE_EXHAUSTED: the atomic claim lost a race for its last use.
 */
function inviteUnavailable(
  invite: InviteRow | undefined,
  opts: { exhaustedIfAvailable?: boolean } = {},
): { status: number; body: { error: string; code: string } } | null {
  if (!invite || invite.revoked) {
    return { status: 404, body: { error: "Invite not found", code: "NOT_FOUND" } };
  }
  if (invite.expiresAt && invite.expiresAt < Date.now()) {
    return { status: 410, body: { error: "Invite has expired", code: "INVITE_EXPIRED" } };
  }
  if ((invite.maxUses && invite.useCount >= invite.maxUses) || opts.exhaustedIfAvailable) {
    return { status: 410, body: { error: "Invite has been fully used", code: "INVITE_EXHAUSTED" } };
  }
  return null;
}

export const invitesRoutes: FastifyPluginAsync = async (server) => {
  // Create invite
  server.post("/", async (request, reply) => {
    const body = validate(createInviteBody, request.body, reply);
    if (!body) return;

    const { spaceId, maxUses, expiresInHours, label, autoAssignRole } = body;
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const perm = await permissionService.check(spaceId, pubkey, "CREATE_INVITES");
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    if (autoAssignRole) {
      const [role] = await db
        .select()
        .from(spaceRoles)
        .where(and(eq(spaceRoles.id, autoAssignRole), eq(spaceRoles.spaceId, spaceId)))
        .limit(1);
      if (!role) return reply.status(404).send({ error: "Role not found", code: "NOT_FOUND" });
      // Anyone with CREATE_INVITES may hand out the default role (redeem falls
      // back to it anyway); every other role follows the hierarchy rule, so a
      // member can't mint an Admin invite and only the creator mints admins.
      if (!role.isDefault) {
        const rank = await getActorRank(spaceId, pubkey);
        if (!canManageRole(rank, role)) {
          return reply.status(403).send({ error: "Cannot create an invite for a role equal to or above your own", code: "FORBIDDEN" });
        }
      }
    }

    const code = nanoid(8);
    const expiresAt = expiresInHours ? Date.now() + expiresInHours * 3600 * 1000 : null;

    await db.insert(invites).values({
      code,
      spaceId,
      createdBy: pubkey,
      maxUses: maxUses ?? null,
      expiresAt,
      label: label ?? null,
      autoAssignRole: autoAssignRole ?? null,
    });

    return { data: { code } };
  });

  // Get invite with preview (public, no auth required)
  server.get<{ Params: { code: string } }>("/:code", async (request, reply) => {
    const params = validate(codeParams, request.params, reply);
    if (!params) return;
    const { code } = params;

    const rows = await db
      .select({
        invite: invites,
        spaceName: spaces.name,
        spacePicture: spaces.picture,
        spaceAbout: spaces.about,
        spaceMemberCount: spaces.memberCount,
        spaceMode: spaces.mode,
      })
      .from(invites)
      .leftJoin(spaces, eq(invites.spaceId, spaces.id))
      .where(eq(invites.code, code))
      .limit(1);

    const row = rows[0];
    if (!row || row.invite.revoked) {
      return reply.status(404).send({ error: "Invite not found", code: "NOT_FOUND" });
    }

    const inv = row.invite;

    // Check expiry
    if (inv.expiresAt && inv.expiresAt < Date.now()) {
      return reply.status(410).send({ error: "Invite has expired", code: "INVITE_EXPIRED" });
    }

    // Check max uses
    if (inv.maxUses && inv.useCount >= inv.maxUses) {
      return reply.status(410).send({ error: "Invite has been fully used", code: "INVITE_EXHAUSTED" });
    }

    return {
      data: {
        ...inv,
        space: {
          name: row.spaceName ?? "Space",
          picture: row.spacePicture ?? null,
          about: row.spaceAbout ?? null,
          memberCount: row.spaceMemberCount ?? 0,
          mode: (row.spaceMode as "read" | "read-write") ?? "read-write",
        },
      },
    };
  });

  // Redeem invite
  server.post<{ Params: { code: string } }>("/:code/redeem", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const params = validate(codeParams, request.params, reply);
    if (!params) return;
    const { code } = params;
    const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);

    // Fast refusals that burn nothing. The claim below re-checks the same
    // conditions atomically, so these only save a transaction.
    const unavailable = inviteUnavailable(invite);
    if (unavailable) return reply.status(unavailable.status).send(unavailable.body);

    // Bans hold across every join path.
    if (await moderationService.isBanned(invite.spaceId, pubkey)) {
      return reply.status(403).send({ error: "You are banned from this space", code: "BANNED" });
    }

    const [existing] = await db
      .select({ pubkey: spaceMembers.pubkey })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, invite.spaceId), eq(spaceMembers.pubkey, pubkey)))
      .limit(1);
    if (existing) {
      return reply.status(409).send({ error: "Already a member of this space", code: "ALREADY_MEMBER" });
    }

    // Honour autoAssignRole only when it still belongs to this space, and an
    // admin role only when the creator minted the invite (rows predating the
    // create-time check may name one). Otherwise the space's default role, so
    // new members get basic permissions (SEND_MESSAGES, etc.).
    let roleToAssign: string | null = null;
    if (invite.autoAssignRole) {
      const [role] = await db
        .select()
        .from(spaceRoles)
        .where(and(eq(spaceRoles.id, invite.autoAssignRole), eq(spaceRoles.spaceId, invite.spaceId)))
        .limit(1);
      if (role && (!role.isAdmin || (await isSpaceCreator(invite.spaceId, invite.createdBy)))) {
        roleToAssign = role.id;
      }
    }
    if (!roleToAssign) {
      const [defaultRole] = await db
        .select({ id: spaceRoles.id })
        .from(spaceRoles)
        .where(and(eq(spaceRoles.spaceId, invite.spaceId), eq(spaceRoles.isDefault, true)))
        .limit(1);
      roleToAssign = defaultRole?.id ?? null;
    }

    // Claim a use and add the member in one transaction. The conditional
    // UPDATE is the race guard: concurrent redeemers queue on the invite's row
    // lock and re-check the WHERE clause against the committed use_count, so
    // a 1-use invite admits exactly one of them. If the member row already
    // exists (the same user redeeming twice at once), roll back so no use is
    // burned.
    let memberCount: number | null;
    try {
      memberCount = await db.transaction(async (tx) => {
        const now = Date.now();
        const claimed = await tx
          .update(invites)
          .set({ useCount: sql`${invites.useCount} + 1` })
          .where(
            and(
              eq(invites.code, code),
              eq(invites.revoked, false),
              or(isNull(invites.expiresAt), gt(invites.expiresAt, now)),
              or(isNull(invites.maxUses), eq(invites.maxUses, 0), lt(invites.useCount, invites.maxUses)),
            ),
          )
          .returning({ code: invites.code });
        if (claimed.length === 0) throw new RedeemRefused("unavailable");

        const inserted = await tx
          .insert(spaceMembers)
          .values({ spaceId: invite.spaceId, pubkey })
          .onConflictDoNothing()
          .returning({ pubkey: spaceMembers.pubkey });
        if (inserted.length === 0) throw new RedeemRefused("already_member");

        if (roleToAssign) {
          await tx
            .insert(memberRoles)
            .values({ spaceId: invite.spaceId, pubkey, roleId: roleToAssign })
            .onConflictDoNothing();
        }
        return refreshMemberCount(tx, invite.spaceId);
      });
    } catch (err) {
      if (!(err instanceof RedeemRefused)) throw err;
      if (err.reason === "already_member") {
        return reply.status(409).send({ error: "Already a member of this space", code: "ALREADY_MEMBER" });
      }
      const [latest] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
      const refusal = inviteUnavailable(latest, { exhaustedIfAvailable: true })!;
      return reply.status(refusal.status).send(refusal.body);
    }

    notifySpaceChanged(invite.spaceId, "members");

    const [space] = await db.select().from(spaces).where(eq(spaces.id, invite.spaceId)).limit(1);
    const obConfig = await onboardingService.getConfig(invite.spaceId);

    return {
      data: {
        spaceId: invite.spaceId,
        space: space
          ? {
              name: space.name,
              picture: space.picture,
              about: space.about,
              memberCount: memberCount ?? space.memberCount,
              mode: space.mode,
              creatorPubkey: space.creatorPubkey,
              hostRelay: space.hostRelay,
              listed: space.listed,
            }
          : null,
        onboarding: obConfig?.enabled
          ? { hasOnboarding: true, requireCompletion: obConfig.requireCompletion }
          : null,
      },
    };
  });

  // List active invites for a space (admin only)
  server.get<{ Params: { spaceId: string } }>("/space/:spaceId", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const params = validate(spaceIdParams, request.params, reply);
    if (!params) return;
    const { spaceId } = params;

    const manage = await permissionService.check(spaceId, pubkey, "MANAGE_INVITES");
    const perm = manage.allowed ? manage : await permissionService.check(spaceId, pubkey, "CREATE_INVITES");
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    const activeInvites = await db
      .select()
      .from(invites)
      .where(and(eq(invites.spaceId, spaceId), eq(invites.revoked, false)));

    return { data: activeInvites };
  });

  // Revoke invite (auth + ownership). Closes #57: previously unauthenticated.
  server.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const params = validate(idParams, request.params, reply);
    if (!params) return;
    const { id } = params;

    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    // Unknown or already-revoked code → 404 (no longer a silent success).
    const [invite] = await db.select().from(invites).where(eq(invites.code, id)).limit(1);
    if (!invite || invite.revoked) {
      return reply.status(404).send({ error: "Invite not found", code: "NOT_FOUND" });
    }

    // Authorize: the creator of the space, the invite's own creator, or a member
    // holding MANAGE_INVITES / CREATE_INVITES on that space.
    const [space] = await db.select().from(spaces).where(eq(spaces.id, invite.spaceId)).limit(1);
    const isSpaceCreator = !!space?.creatorPubkey && space.creatorPubkey === pubkey;
    const isInviteCreator = invite.createdBy === pubkey;
    let authorized = isSpaceCreator || isInviteCreator;
    if (!authorized) {
      const manage = await permissionService.check(invite.spaceId, pubkey, "MANAGE_INVITES");
      const create = manage.allowed ? manage : await permissionService.check(invite.spaceId, pubkey, "CREATE_INVITES");
      authorized = manage.allowed || create.allowed;
    }
    if (!authorized) {
      return reply.status(403).send({ error: "Not allowed to revoke this invite", code: "FORBIDDEN" });
    }

    await db.update(invites).set({ revoked: true }).where(eq(invites.code, id));
    return { data: { success: true } };
  });
};
