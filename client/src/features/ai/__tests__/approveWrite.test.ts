import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PendingWrite } from "@/types/ai";
import type { UnsignedEvent } from "@/types/nostr";

const h = vi.hoisted(() => ({
  state: undefined as unknown as Record<string, unknown>,
  dispatched: [] as { type: string; payload: { id: string; changes: Partial<PendingWrite> } }[],
  published: [] as { unsigned: UnsignedEvent; relays?: string[] }[],
  dms: [] as { pk: string; content: string }[],
}));

vi.mock("@/store", () => ({
  store: { getState: () => h.state, dispatch: (a: { type: string; payload: { id: string; changes: Partial<PendingWrite> } }) => h.dispatched.push(a) },
}));
vi.mock("@/lib/nostr/publish", () => ({
  signAndPublish: async (unsigned: UnsignedEvent, relays?: string[]) => {
    h.published.push({ unsigned, relays });
    return { ...unsigned, id: "id", sig: "sig" };
  },
}));
vi.mock("@/features/dm/dmService", () => ({
  sendDM: async (pk: string, content: string) => {
    h.dms.push({ pk, content });
  },
}));
vi.mock("@/lib/nostr/relayManager", () => ({
  relayManager: {
    getWriteRelays: () => [{}, {}, {}],
    connect: vi.fn(),
    waitForConnection: async () => {},
  },
}));

import { approvePendingWrite, cancelPendingWrite } from "../gate/approveWrite";

function w(over: Partial<PendingWrite>): PendingWrite {
  return {
    id: "call1",
    conversationId: "c1",
    messageId: "m1",
    kind: "note",
    summary: "",
    content: "hello world",
    status: "pending",
    createdAt: 1,
    ...over,
  };
}

function changesWithStatus(status: string) {
  return h.dispatched.find(
    (a) => a.type.endsWith("updatePendingWrite") && a.payload.changes.status === status,
  )?.payload.changes;
}

function tag(unsigned: UnsignedEvent, key: string) {
  return unsigned.tags.find((t) => t[0] === key);
}

beforeEach(() => {
  h.state = {
    identity: { pubkey: "me" },
    spaces: { list: [] as unknown[], channels: {} as Record<string, unknown[]> },
    // The live-status precondition reads pendingWrites; the default write id is call1.
    ai: { pendingWrites: { call1: { status: "pending" } } as Record<string, { status: string }> },
  };
  h.dispatched = [];
  h.published = [];
  h.dms = [];
});

describe("approvePendingWrite — kind → builder → sign", () => {
  it("note → signs an unsigned kind:1 and reports relay count", async () => {
    await approvePendingWrite(w({ kind: "note", content: "gm" }));
    expect(h.published).toHaveLength(1);
    expect(h.published[0].unsigned.kind).toBe(1);
    expect(h.published[0].unsigned.content).toBe("gm");
    expect(changesWithStatus("publishing")).toBeTruthy(); // pending state shown first
    expect(changesWithStatus("done")?.result).toContain("3 relays");
  });

  it("reply → kind:1 with e/p tags to the target", async () => {
    await approvePendingWrite(
      w({ kind: "reply", content: "nice", replyToEventId: "ev1", replyToPubkey: "alice" }),
    );
    const u = h.published[0].unsigned;
    expect(u.kind).toBe(1);
    expect(tag(u, "e")).toBeTruthy();
    expect(tag(u, "p")?.[1]).toBe("alice");
  });

  it("article → kind:30023 with title", async () => {
    await approvePendingWrite(w({ kind: "article", title: "My Post", content: "body" }));
    const u = h.published[0].unsigned;
    expect(u.kind).toBe(30023);
    expect(tag(u, "title")?.[1]).toBe("My Post");
  });

  it("dm → sendDM, never a public publish", async () => {
    await approvePendingWrite(w({ kind: "dm", content: "psst", recipientPubkey: "bob", recipientLabel: "bob" }));
    expect(h.dms).toEqual([{ pk: "bob", content: "psst" }]);
    expect(h.published).toHaveLength(0);
    expect(changesWithStatus("done")?.result).toContain("bob");
  });

  it("space_message → buildChatMessage (kind:9) to the host relay", async () => {
    h.state = {
      identity: { pubkey: "me" },
      spaces: {
        list: [{ id: "s1", name: "Space", hostRelay: "wss://host", mode: "read-write" }],
        channels: { s1: [{ id: "ch1", type: "chat", label: "general" }] },
      },
      ai: { pendingWrites: { call1: { status: "pending" } } },
    };
    await approvePendingWrite(w({ kind: "space_message", content: "hey", spaceId: "s1", channelId: "ch1" }));
    const { unsigned, relays } = h.published[0];
    expect(unsigned.kind).toBe(9);
    expect(tag(unsigned, "h")?.[1]).toBe("s1");
    expect(relays).toEqual(["wss://host"]);
  });

  it("applies inline edits and binds to the edited content", async () => {
    await approvePendingWrite(w({ kind: "note", content: "original" }), { content: "edited!" });
    expect(h.published[0].unsigned.content).toBe("edited!");
  });

  it("refuses empty content without publishing", async () => {
    await approvePendingWrite(w({ kind: "note", content: "" }), { content: "   " });
    expect(h.published).toHaveLength(0);
    expect(changesWithStatus("error")).toBeTruthy();
  });

  it("records a failure (e.g. missing reply target) as an error status, no publish", async () => {
    await approvePendingWrite(w({ kind: "reply", content: "x" })); // no replyToEventId
    expect(h.published).toHaveLength(0);
    expect(changesWithStatus("error")).toBeTruthy();
  });
});

describe("cancelPendingWrite", () => {
  it("sets the status to cancelled (no publish)", () => {
    cancelPendingWrite("call1");
    expect(h.dispatched[h.dispatched.length - 1]?.payload.changes.status).toBe("cancelled");
    expect(h.published).toHaveLength(0);
  });
});
