/**
 * A kind 5 must remove the deleted note from the public search index even
 * though the relay has already dropped the row from relay.events by the time
 * it broadcasts the deletion (nip29/moderation.rs deletes, then fans out).
 * Authorship is then proven from the indexed document itself. Meilisearch is
 * faked in-process; Postgres `thewired_test` + ioredis-mock as usual.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";

const meili = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const index = () => ({
    addDocuments: async (batch: Record<string, unknown>[]) => {
      for (const d of batch) docs.set(d.id as string, d);
      return { taskUid: 1 };
    },
    getDocument: async (id: string) => {
      const d = docs.get(id);
      if (!d) throw Object.assign(new Error("document_not_found"), { code: "document_not_found" });
      return d;
    },
    deleteDocument: async (id: string) => {
      docs.delete(id);
      return { taskUid: 2 };
    },
    deleteDocuments: async (ids: string[]) => {
      for (const id of ids) docs.delete(id);
      return { taskUid: 3 };
    },
    search: async () => ({ hits: [] }),
  });
  return { docs, client: { index } };
});
vi.mock("../../src/lib/meilisearch.js", () => ({ getMeilisearchClient: () => meili.client }));

import { processEvent, type IngestContext, type NostrEvent } from "../../src/workers/ingestHandlers.js";
import { getRedis } from "../../src/lib/redis.js";

const own: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };

function signed(sk: Uint8Array, over: { kind: number; tags?: string[][]; content?: string }): NostrEvent {
  return finalizeEvent(
    { kind: over.kind, created_at: Math.floor(Date.now() / 1000), tags: over.tags ?? [], content: over.content ?? "" },
    sk,
  ) as NostrEvent;
}

beforeEach(async () => {
  meili.docs.clear();
  await getRedis().flushall();
});

describe("kind 5 → search index", () => {
  it("removes the author's note when relay.events no longer has the row", async () => {
    const sk = generateSecretKey();
    const note = signed(sk, { kind: 1, content: "deleted content must not stay searchable" });
    await processEvent(note, own);
    expect(meili.docs.has(note.id)).toBe(true);

    // No relay.events row was ever written here — exactly the state after the
    // relay deleted it and then broadcast the kind 5.
    const del = signed(sk, { kind: 5, tags: [["e", note.id]] });
    await processEvent(del, own);
    expect(meili.docs.has(note.id)).toBe(false);
  });

  it("ignores a stranger's kind 5 naming someone else's note", async () => {
    const author = generateSecretKey();
    const note = signed(author, { kind: 1, content: "mine, stays" });
    await processEvent(note, own);

    const stranger = generateSecretKey();
    expect(getPublicKey(stranger)).not.toBe(note.pubkey);
    const del = signed(stranger, { kind: 5, tags: [["e", note.id]] });
    await processEvent(del, own);
    expect(meili.docs.has(note.id)).toBe(true);
  });
});
