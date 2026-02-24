import { db } from "../db/connection.js";
import { pushSubscriptions } from "../db/schema/notifications.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "../lib/id.js";

export const pushService = {
  async subscribe(pubkey: string, endpoint: string, keys: { p256dh: string; auth: string }) {
    await db.insert(pushSubscriptions).values({
      id: nanoid(),
      pubkey,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
  },

  async unsubscribe(pubkey: string, endpoint: string) {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.pubkey, pubkey), eq(pushSubscriptions.endpoint, endpoint)));
  },
};
