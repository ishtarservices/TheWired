import { db } from "../db/connection.js";
import { reputation } from "../db/schema/moderation.js";
import { eq } from "drizzle-orm";

export const spamService = {
  async getReputation(pubkey: string): Promise<number> {
    const [row] = await db.select().from(reputation).where(eq(reputation.pubkey, pubkey)).limit(1);
    return row?.score ?? 100;
  },

  async updateReputation(pubkey: string, delta: number) {
    const current = await this.getReputation(pubkey);
    const newScore = Math.max(0, Math.min(1000, current + delta));
    await db
      .insert(reputation)
      .values({ pubkey, score: newScore })
      .onConflictDoUpdate({ target: reputation.pubkey, set: { score: newScore } });
  },
};
