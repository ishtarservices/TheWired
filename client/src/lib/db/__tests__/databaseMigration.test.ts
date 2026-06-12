import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { getDB } from "../database";
import { putOutbox, getAllOutbox, deleteOutbox } from "../outboxStore";
import type { NostrEvent } from "@/types/nostr";

function ev(id: string): NostrEvent {
  return { id, pubkey: "p".repeat(64), created_at: 1, kind: 1, tags: [], content: "", sig: "s" };
}

beforeEach(async () => {
  const db = await getDB();
  await db.clear("outbox");
});

describe("database v4 migration", () => {
  it("creates the `outbox` store and removes the dead `subscriptions` store", async () => {
    const db = await getDB();
    const stores = [...db.objectStoreNames];
    expect(stores).toContain("outbox"); // #34
    expect(stores).not.toContain("subscriptions"); // #83 — created in v1, dropped in v4
    expect(stores).toContain("aiPendingWrites"); // v3 work preserved
    expect(stores).toContain("events");
  });

  it("outbox roundtrip: put → getAll → delete", async () => {
    await putOutbox(ev("e1"), ["wss://r"], 123);
    let rows = await getAllOutbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "e1", targetRelays: ["wss://r"], queuedAt: 123 });
    expect(rows[0].event.id).toBe("e1");

    await deleteOutbox("e1");
    rows = await getAllOutbox();
    expect(rows).toHaveLength(0);
  });
});
