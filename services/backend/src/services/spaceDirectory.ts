import { db } from "../db/connection.js";
import { spaces } from "../db/schema/spaces.js";
import { eq } from "drizzle-orm";

export const spaceDirectoryService = {
  async indexSpace(spaceId: string, data: { name: string; hostRelay: string; createdAt: number }) {
    await db
      .insert(spaces)
      .values({ id: spaceId, ...data })
      .onConflictDoUpdate({ target: spaces.id, set: { name: data.name } });
  },

  async getSpace(spaceId: string) {
    const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
    return space ?? null;
  },
};
