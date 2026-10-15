/**
 * Pin list writes against a fake relay layer (real signatures): every tap is a
 * read-modify-write of the freshest relay copy — other clients' tags and pins
 * survive, nothing is published when no relay answered, and a list no relay
 * accepted rejects so the caller can roll back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";

type Ev = { id: string; pubkey: string; kind: number; tags: string[][]; content: string; created_at: number };

const h = vi.hoisted(() => ({
  relayEvents: [] as Ev[],
  published: [] as Ev[],
  /** Relays send EOSE (false = nobody answers). */
  answer: true,
  /** Relays accept publishes. */
  accept: true,
  sk: new Uint8Array(32) as Uint8Array,
  pk: "",
}));

vi.mock("@/store", async () => {
  const { createTestStore } = await import("@/__tests__/helpers/createTestStore");
  return { store: createTestStore() };
});
vi.mock("@/lib/nostr/constants", () => ({ APP_RELAY: "wss://app.test" }));
vi.mock("@/lib/nostr/relayManager", () => ({
  relayManager: {
    subscribe: (opts: {
      filters: Array<{ kinds?: number[]; authors?: string[] }>;
      relayUrls: string[];
      onEvent: (e: Ev, url: string) => void;
      onEOSE?: (subId: string, url: string) => void;
    }) => {
      const id = `sub-${Math.random()}`;
      queueMicrotask(() => {
        if (!h.answer) return;
        const f = opts.filters[0];
        for (const e of h.relayEvents) {
          if ((!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))) {
            opts.onEvent(e, opts.relayUrls[0]);
          }
        }
        for (const url of opts.relayUrls) opts.onEOSE?.(id, url);
      });
      return id;
    },
    closeSubscription: vi.fn(),
    getWriteRelays: () => [{ url: "wss://other.test" }],
    publishWithConfirmation: async (event: Ev) => {
      h.published.push(event);
      if (h.accept) h.relayEvents = [...h.relayEvents.filter((e) => e.kind !== event.kind), event];
      return [{ relayUrl: "wss://app.test", success: h.accept, message: "" }];
    },
  },
}));
vi.mock("@/lib/nostr/publish", () => ({
  signWithAccount: async (unsigned: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(unsigned, h.sk),
}));
vi.mock("@/lib/db/userStateStore", () => ({ saveUserState: vi.fn(async () => {}) }));

import { store } from "@/store";
import { login, logout } from "@/store/slices/identitySlice";
import { __resetPinListWriteForTest, updatePinnedNotes } from "../pinListWrite";

const id = (c: string) => c.repeat(64);

function pinList(tags: string[][], created_at = 500, content = ""): Ev {
  return finalizeEvent({ kind: 10001, created_at, tags, content }, h.sk) as Ev;
}

beforeEach(() => {
  h.sk = generateSecretKey();
  h.pk = getPublicKey(h.sk);
  h.relayEvents = [];
  h.published = [];
  h.answer = true;
  h.accept = true;
  __resetPinListWriteForTest();
  store.dispatch(logout());
  store.dispatch(login({ pubkey: h.pk, signerType: "nip07" }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("updatePinnedNotes", () => {
  it("appends to the freshest relay copy, keeping foreign tags and the private half", async () => {
    h.relayEvents = [
      pinList(
        [
          ["e", id("7"), "wss://their.relay", "x"],
          ["a", `30023:${"b".repeat(64)}:essay`],
        ],
        900,
        "nip44-ciphertext",
      ),
    ];
    // Redux never saw that list — the write must read it, not rebuild from ids.
    expect(store.getState().identity.pinnedNoteIds).toEqual([]);
    await updatePinnedNotes(h.pk, { id: id("1"), pin: true });

    expect(h.published).toHaveLength(1);
    const out = h.published[0];
    expect(out.tags).toEqual([
      ["e", id("7"), "wss://their.relay", "x"],
      ["a", `30023:${"b".repeat(64)}:essay`],
      ["e", id("1"), "wss://app.test"],
    ]);
    expect(out.content).toBe("nip44-ciphertext");
    expect(out.created_at).toBeGreaterThan(900);
    expect(store.getState().identity.pinnedNoteIds).toEqual([id("7"), id("1")]);
  });

  it("unpins by dropping the id's tags only", async () => {
    h.relayEvents = [pinList([["e", id("1")], ["e", id("2"), "wss://x"]])];
    await updatePinnedNotes(h.pk, { id: id("1"), pin: false });
    expect(h.published[0].tags).toEqual([["e", id("2"), "wss://x"]]);
  });

  it("two quick taps both land — the second builds on the first", async () => {
    await Promise.all([
      updatePinnedNotes(h.pk, { id: id("1"), pin: true }),
      updatePinnedNotes(h.pk, { id: id("2"), pin: true }),
    ]);
    expect(h.published.map((e) => e.tags)).toEqual([
      [["e", id("1"), "wss://app.test"]],
      [
        ["e", id("1"), "wss://app.test"],
        ["e", id("2"), "wss://app.test"],
      ],
    ]);
  });

  it("builds on its own last publish when the relays lag behind it", async () => {
    await updatePinnedNotes(h.pk, { id: id("1"), pin: true });
    h.relayEvents = []; // a lagging relay set: answers, holds nothing
    await updatePinnedNotes(h.pk, { id: id("2"), pin: true });
    expect(h.published[1].tags).toEqual([
      ["e", id("1"), "wss://app.test"],
      ["e", id("2"), "wss://app.test"],
    ]);
  });

  it("a pin the relays already hold settles without a publish", async () => {
    h.relayEvents = [pinList([["e", id("1")]])];
    await updatePinnedNotes(h.pk, { id: id("1"), pin: true });
    expect(h.published).toHaveLength(0);
    expect(store.getState().identity.pinnedNoteIds).toEqual([id("1")]);
  });

  it("never publishes when no relay answered", async () => {
    vi.useFakeTimers();
    h.answer = false;
    const run = updatePinnedNotes(h.pk, { id: id("1"), pin: true });
    const settled = expect(run).rejects.toThrow(/No relay answered/);
    await vi.advanceTimersByTimeAsync(7_000);
    await settled;
    expect(h.published).toHaveLength(0);
  });

  it("rejects when no relay accepted the list", async () => {
    h.accept = false;
    await expect(updatePinnedNotes(h.pk, { id: id("1"), pin: true })).rejects.toThrow(
      /No relay accepted/,
    );
    expect(store.getState().identity.pinnedNoteIds).toEqual([]);
  });
});
