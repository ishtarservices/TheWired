import { getDB } from "./database";
import type { NostrEvent } from "../../types/nostr";

export interface OutboxRow {
  id: string;
  event: NostrEvent;
  targetRelays?: string[];
  queuedAt: number;
}

/** Queue a signed event for durable re-delivery. Keyed by event id, so re-queuing
 *  the same event is idempotent. */
export async function putOutbox(
  event: NostrEvent,
  targetRelays: string[] | undefined,
  queuedAt: number,
): Promise<void> {
  const db = await getDB();
  await db.put("outbox", { id: event.id, event, targetRelays, queuedAt });
}

export async function deleteOutbox(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("outbox", id);
}

export async function getAllOutbox(): Promise<OutboxRow[]> {
  const db = await getDB();
  return (await db.getAll("outbox")) as OutboxRow[];
}
