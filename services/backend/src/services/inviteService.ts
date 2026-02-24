import { db } from "../db/connection.js";
import { invites } from "../db/schema/invites.js";
import { eq, sql } from "drizzle-orm";

export const inviteService = {
  async validate(code: string): Promise<{ valid: boolean; reason?: string }> {
    const [invite] = await db.select().from(invites).where(eq(invites.code, code)).limit(1);
    if (!invite) return { valid: false, reason: "Invite not found" };
    if (invite.revoked) return { valid: false, reason: "Invite revoked" };
    if (invite.expiresAt && invite.expiresAt < Date.now()) return { valid: false, reason: "Invite expired" };
    if (invite.maxUses && invite.useCount >= invite.maxUses) return { valid: false, reason: "Invite exhausted" };
    return { valid: true };
  },

  async redeem(code: string) {
    await db
      .update(invites)
      .set({ useCount: sql`${invites.useCount} + 1` })
      .where(eq(invites.code, code));
  },
};
