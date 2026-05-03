import { nanoid } from "../lib/id.js";
import { db } from "../db/connection.js";
import { bans, timedMutes, moderationAuditLog } from "../db/schema/moderation.js";
import { spaceMembers } from "../db/schema/members.js";
import { eq, and, gt, or, isNull, desc } from "drizzle-orm";

interface BanParams {
  pubkey: string;
  reason?: string;
  bannedBy: string;
  expiresAt?: number;
}

interface MuteParams {
  pubkey: string;
  mutedBy: string;
  durationSeconds: number;
  channelId?: string;
}

/** Write an entry to the moderation audit log */
async function logAuditEntry(
  spaceId: string,
  actorPubkey: string,
  action: string,
  targetPubkey?: string,
  details?: Record<string, unknown>,
) {
  try {
    await db.insert(moderationAuditLog).values({
      id: nanoid(12),
      spaceId,
      actorPubkey,
      action,
      targetPubkey: targetPubkey ?? null,
      details: details ? JSON.stringify(details) : null,
    });
  } catch {
    // Audit logging should never block the main operation
  }
}

export const moderationService = {
  /** Ban a member from a space */
  async banMember(spaceId: string, params: BanParams) {
    const id = nanoid(12);
    const [ban] = await db
      .insert(bans)
      .values({
        id,
        spaceId,
        pubkey: params.pubkey,
        reason: params.reason,
        bannedBy: params.bannedBy,
        expiresAt: params.expiresAt,
      })
      .returning();

    // Remove from space members
    await db
      .delete(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, params.pubkey)));

    await logAuditEntry(spaceId, params.bannedBy, "ban", params.pubkey, {
      reason: params.reason,
      expiresAt: params.expiresAt,
    });

    return ban;
  },

  /** Unban a member */
  async unbanMember(spaceId: string, pubkey: string, actorPubkey?: string) {
    await db
      .delete(bans)
      .where(and(eq(bans.spaceId, spaceId), eq(bans.pubkey, pubkey)));
    if (actorPubkey) {
      await logAuditEntry(spaceId, actorPubkey, "unban", pubkey);
    }
  },

  /** List active bans (not expired) */
  async listBans(spaceId: string) {
    const now = Math.floor(Date.now() / 1000);
    return db
      .select()
      .from(bans)
      .where(
        and(
          eq(bans.spaceId, spaceId),
          or(isNull(bans.expiresAt), gt(bans.expiresAt, now)),
        ),
      );
  },

  /** Mute a member */
  async muteMember(spaceId: string, params: MuteParams) {
    const id = nanoid(12);
    const expiresAt = Math.floor(Date.now() / 1000) + params.durationSeconds;

    const [mute] = await db
      .insert(timedMutes)
      .values({
        id,
        spaceId,
        pubkey: params.pubkey,
        channelId: params.channelId,
        mutedBy: params.mutedBy,
        expiresAt,
      })
      .returning();

    await logAuditEntry(spaceId, params.mutedBy, "mute", params.pubkey, {
      durationSeconds: params.durationSeconds,
      channelId: params.channelId,
    });

    return mute;
  },

  /** Unmute a member */
  async unmuteMember(muteId: string) {
    await db.delete(timedMutes).where(eq(timedMutes.id, muteId));
  },

  /** List active mutes (not expired) */
  async listMutes(spaceId: string) {
    const now = Math.floor(Date.now() / 1000);
    return db
      .select()
      .from(timedMutes)
      .where(and(eq(timedMutes.spaceId, spaceId), gt(timedMutes.expiresAt, now)));
  },

  /**
   * Kick a member (remove without banning).
   *
   * Note: rows in `app.member_roles` are intentionally NOT cascade-deleted here.
   * `getAllMembersWithRoles` (the data source for `/spaces/:id/member-roles`)
   * JOINs through `app.space_members`, so orphaned `member_roles` rows are
   * filtered out at read time and invisible to clients. Leaving them in place
   * means a re-invite restores the user's prior role assignments without an
   * audit-log gap. If you ever expose `member_roles` directly (e.g. an admin
   * report endpoint), revisit this and add an explicit cascade.
   */
  async kickMember(spaceId: string, pubkey: string, actorPubkey?: string) {
    await db
      .delete(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)));
    if (actorPubkey) {
      await logAuditEntry(spaceId, actorPubkey, "kick", pubkey);
    }
  },

  /** Check if a pubkey is banned from a space */
  async isBanned(spaceId: string, pubkey: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const result = await db
      .select()
      .from(bans)
      .where(
        and(
          eq(bans.spaceId, spaceId),
          eq(bans.pubkey, pubkey),
          or(isNull(bans.expiresAt), gt(bans.expiresAt, now)),
        ),
      )
      .limit(1);
    return result.length > 0;
  },

  /** List recent audit log entries for a space */
  async listAuditLog(spaceId: string, limit = 50) {
    return db
      .select()
      .from(moderationAuditLog)
      .where(eq(moderationAuditLog.spaceId, spaceId))
      .orderBy(desc(moderationAuditLog.createdAt))
      .limit(limit);
  },

  /** Check if a pubkey is muted in a space (optionally in a specific channel) */
  async isMuted(spaceId: string, pubkey: string, channelId?: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const conditions = [
      eq(timedMutes.spaceId, spaceId),
      eq(timedMutes.pubkey, pubkey),
      gt(timedMutes.expiresAt, now),
    ];

    // Check space-wide mutes or channel-specific mutes
    const result = await db
      .select()
      .from(timedMutes)
      .where(and(...conditions))
      .limit(1);

    if (result.length > 0) {
      // Space-wide mute (no channelId) always applies
      if (!result[0].channelId) return true;
      // Channel-specific mute applies if matching
      if (channelId && result[0].channelId === channelId) return true;
    }

    return false;
  },
};
