import type { NostrEvent } from "../../types/nostr";
import { getDB, type TheWiredDB } from "./database";

type StoredEvent = TheWiredDB["events"]["value"];

const REGULAR_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const ADDRESSABLE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

function isAddressable(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

function toStored(event: NostrEvent): StoredEvent {
  const groupId = event.tags.find((t) => t[0] === "h")?.[1];
  return {
    ...event,
    _cachedAt: Date.now(),
    _groupId: groupId,
  };
}

export async function putEvent(event: NostrEvent): Promise<void> {
  const db = await getDB();
  await db.put("events", toStored(event));
}

export async function putEvents(events: NostrEvent[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("events", "readwrite");
  for (const event of events) {
    tx.store.put(toStored(event));
  }
  await tx.done;
}

export async function getEvent(id: string): Promise<NostrEvent | undefined> {
  const db = await getDB();
  const stored = await db.get("events", id);
  return stored ? stripMeta(stored) : undefined;
}

export async function getEventsByKind(
  kind: number,
  limit = 50,
): Promise<NostrEvent[]> {
  const db = await getDB();
  const results = await db.getAllFromIndex("events", "by_kind", kind, limit);
  return results.map(stripMeta);
}

export async function getEventsByGroup(
  groupId: string,
  kind: number,
  limit = 50,
): Promise<NostrEvent[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("events", "by_group", groupId);
  return all
    .filter((e) => e.kind === kind)
    .sort((a, b) => a.created_at - b.created_at)
    .slice(-limit)
    .map(stripMeta);
}

export async function deleteExpiredEvents(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction("events", "readwrite");
  const now = Date.now();
  let deleted = 0;

  let cursor = await tx.store.index("by_cached_at").openCursor();
  while (cursor) {
    const ttl = isAddressable(cursor.value.kind)
      ? ADDRESSABLE_TTL
      : REGULAR_TTL;
    if (now - cursor.value._cachedAt > ttl) {
      await cursor.delete();
      deleted++;
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  return deleted;
}

export async function getEventCount(): Promise<number> {
  const db = await getDB();
  return db.count("events");
}

function stripMeta(stored: StoredEvent): NostrEvent {
  return {
    id: stored.id,
    pubkey: stored.pubkey,
    created_at: stored.created_at,
    kind: stored.kind,
    tags: stored.tags,
    content: stored.content,
    sig: stored.sig,
  };
}
