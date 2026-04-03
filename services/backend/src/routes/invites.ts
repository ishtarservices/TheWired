import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { invites } from "../db/schema/invites.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceMembers, memberRoles } from "../db/schema/members.js";
import { spaceRoles } from "../db/schema/permissions.js";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "../lib/id.js";
import { permissionService } from "../services/permissionService.js";
import { onboardingService } from "../services/onboardingService.js";

export const invitesRoutes: FastifyPluginAsync = async (server) => {
  // Create invite
  server.post("/", async (request, reply) => {
    const { spaceId, maxUses, expiresInHours, label, autoAssignRole } = request.body as {
      spaceId: string;
      maxUses?: number;
      expiresInHours?: number;
      label?: string;
      autoAssignRole?: string;
    };
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const perm = await permissionService.check(spaceId, pubkey, "CREATE_INVITES");
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
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
    const { code } = request.params;

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

    const { code } = request.params;
    const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);

    if (!invite || invite.revoked) {
      return reply.status(404).send({ error: "Invite not found", code: "NOT_FOUND" });
    }

    // Check expiry
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      return reply.status(410).send({ error: "Invite has expired", code: "INVITE_EXPIRED" });
    }

    // Check max uses
    if (invite.maxUses && invite.useCount >= invite.maxUses) {
      return reply.status(410).send({ error: "Invite has been fully used", code: "INVITE_EXHAUSTED" });
    }

    // Check if already a member
    const [existing] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, invite.spaceId), eq(spaceMembers.pubkey, pubkey)))
      .limit(1);

    if (existing) {
      return reply.status(409).send({ error: "Already a member of this space", code: "ALREADY_MEMBER" });
    }

    // Insert member + increment use count
    await db.insert(spaceMembers).values({
      spaceId: invite.spaceId,
      pubkey,
    });

    await db
      .update(invites)
      .set({ useCount: sql`${invites.useCount} + 1` })
      .where(eq(invites.code, code));

    // Assign role: use explicit autoAssignRole, or fall back to the
    // space's default role so new members get basic permissions (SEND_MESSAGES, etc.)
    let roleToAssign = invite.autoAssignRole;
    if (!roleToAssign) {
      const [defaultRole] = await db
        .select({ id: spaceRoles.id })
        .from(spaceRoles)
        .where(and(eq(spaceRoles.spaceId, invite.spaceId), eq(spaceRoles.isDefault, true)))
        .limit(1);
      roleToAssign = defaultRole?.id ?? null;
    }

    if (roleToAssign) {
      await db.insert(memberRoles).values({
        spaceId: invite.spaceId,
        pubkey,
        roleId: roleToAssign,
      }).onConflictDoNothing();
    }

    // Fetch space info to return
    const [space] = await db.select().from(spaces).where(eq(spaces.id, invite.spaceId)).limit(1);

    // Check if space has onboarding enabled
    const obConfig = await onboardingService.getConfig(invite.spaceId);

    return {
      data: {
        spaceId: invite.spaceId,
        space: space
          ? { name: space.name, picture: space.picture, about: space.about, memberCount: space.memberCount, mode: space.mode }
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

    const { spaceId } = request.params;

    const perm = await permissionService.check(spaceId, pubkey, "CREATE_INVITES");
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    const activeInvites = await db
      .select()
      .from(invites)
      .where(and(eq(invites.spaceId, spaceId), eq(invites.revoked, false)));

    return { data: activeInvites };
  });

  // Revoke invite
  server.delete<{ Params: { id: string } }>("/:id", async (request) => {
    const { id } = request.params;
    await db.update(invites).set({ revoked: true }).where(eq(invites.code, id));
    return { data: { success: true } };
  });
};
