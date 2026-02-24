import { getDB } from "./database";

/** Save last EOSE timestamps for a subscription */
export async function saveSubscriptionState(
  subId: string,
  lastEose: Record<string, number>,
  filters: unknown[],
): Promise<void> {
  const db = await getDB();
  await db.put("subscriptions", {
    sub_id: subId,
    last_eose: lastEose,
    filters,
  });
}

/** Get last EOSE timestamps for reconnect `since` computation */
export async function getSubscriptionState(
  subId: string,
): Promise<{ lastEose: Record<string, number>; filters: unknown[] } | undefined> {
  const db = await getDB();
  const stored = await db.get("subscriptions", subId);
  if (!stored) return undefined;
  return { lastEose: stored.last_eose, filters: stored.filters };
}

/** Clear subscription state */
export async function clearSubscriptionState(subId: string): Promise<void> {
  const db = await getDB();
  await db.delete("subscriptions", subId);
}
