import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import type { PendingWrite } from "@/types/ai";
import {
  putPendingWrite,
  loadPendingWritesForAccount,
  PENDING_WRITE_TTL_MS,
} from "@/lib/db/aiPendingWriteStore";
import { putConversation, deleteConversation } from "@/lib/db/aiConversationStore";
import { getDB } from "@/lib/db/database";

function w(over: Partial<PendingWrite> = {}): PendingWrite {
  return {
    id: `w-${Math.random().toString(36).slice(2)}`,
    toolCallId: "call_0",
    conversationId: "c1",
    messageId: "m1",
    kind: "note",
    summary: "Post a public note",
    content: "draft body",
    status: "pending",
    createdAt: Date.now(),
    ...over,
  };
}

beforeEach(async () => {
  const db = await getDB();
  const tx = db.transaction(["aiPendingWrites", "aiConversations", "aiMessages"], "readwrite");
  await tx.objectStore("aiPendingWrites").clear();
  await tx.objectStore("aiConversations").clear();
  await tx.objectStore("aiMessages").clear();
  await tx.done;
});

describe("aiPendingWriteStore (audit #48/#98 probes)", () => {
  it("PROBE #98: a pending draft survives a reload (put → load round-trip, account-scoped)", async () => {
    // Pre-fix, pendingWrites were Redux-only: the persisted conversation said a
    // draft awaited approval, but a reload silently dropped it.
    const mine = w({ id: "w1", content: "my draft" });
    const other = w({ id: "w2", conversationId: "c9" });
    await putPendingWrite(mine, "me");
    await putPendingWrite(other, "someone-else");

    const loaded = await loadPendingWritesForAccount("me");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(mine); // _account/_cachedAt stripped
  });

  it("PROBE #98: drafts older than 24h hydrate as expired (unsignable), and the flip persists", async () => {
    const stale = w({ id: "w-old", createdAt: Date.now() - PENDING_WRITE_TTL_MS - 60_000 });
    const fresh = w({ id: "w-new" });
    await putPendingWrite(stale, "me");
    await putPendingWrite(fresh, "me");

    const loaded = await loadPendingWritesForAccount("me");
    const byId = Object.fromEntries(loaded.map((x) => [x.id, x]));
    expect(byId["w-old"].status).toBe("expired");
    expect(byId["w-new"].status).toBe("pending");

    // The flip is written back, not recomputed-only.
    const again = await loadPendingWritesForAccount("me");
    expect(again.find((x) => x.id === "w-old")?.status).toBe("expired");
  });

  it("a draft interrupted mid-publish hydrates as an error (actionable), not stuck publishing", async () => {
    await putPendingWrite(w({ id: "w-pub", status: "publishing" }), "me");
    const loaded = await loadPendingWritesForAccount("me");
    expect(loaded[0].status).toBe("error");
    expect(loaded[0].error).toMatch(/interrupted/i);
  });

  it("resolved drafts (done/cancelled) hydrate unchanged regardless of age", async () => {
    const old = Date.now() - PENDING_WRITE_TTL_MS * 3;
    await putPendingWrite(w({ id: "w-done", status: "done", createdAt: old, result: "Published" }), "me");
    await putPendingWrite(w({ id: "w-cxl", status: "cancelled", createdAt: old }), "me");
    const loaded = await loadPendingWritesForAccount("me");
    const byId = Object.fromEntries(loaded.map((x) => [x.id, x]));
    expect(byId["w-done"].status).toBe("done");
    expect(byId["w-cxl"].status).toBe("cancelled");
  });

  it("deleting a conversation cascades its persisted drafts", async () => {
    await putConversation(
      { id: "c1", title: "t", providerId: null, model: null, createdAt: 1, updatedAt: 1 },
      "me",
    );
    await putPendingWrite(w({ id: "w-c1", conversationId: "c1" }), "me");
    await putPendingWrite(w({ id: "w-c2", conversationId: "c2" }), "me");

    await deleteConversation("c1");

    const loaded = await loadPendingWritesForAccount("me");
    expect(loaded.map((x) => x.id)).toEqual(["w-c2"]);
  });
});
