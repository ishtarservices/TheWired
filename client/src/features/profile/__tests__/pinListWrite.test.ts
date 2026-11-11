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
  /** Per-relay behaviour (default: answers at once with relayEvents). */
  relayCfg: {} as Record<string, { delayMs?: number; answer?: boolean; events?: Ev[]; eoses?: number }>,
  /** Targets of each publish. */
  publishTargets: [] as (string[] | undefined)[],
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
      const f = opts.filters[0];
      for (const url of opts.relayUrls) {
        const cfg = h.relayCfg[url] ?? {};
        const deliver = () => {
          if (!(cfg.answer ?? h.answer)) return;
          for (const e of cfg.events ?? h.relayEvents) {
            if ((!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))) {
              opts.onEvent(e, url);
            }
          }
          for (let i = 0; i < (cfg.eoses ?? 1); i++) opts.onEOSE?.(id, url);
        };
        if (cfg.delayMs) setTimeout(deliver, cfg.delayMs);
        else queueMicrotask(deliver);
      }
      return id;
    },
    closeSubscription: vi.fn(),
    getWriteRelays: () => [{ url: "wss://other.test" }],
    publishWithConfirmation: async (event: Ev, targets?: string[]) => {
      h.published.push(event);
      h.publishTargets.push(targets);
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
import { applyPinnedNoteOp, login, logout, setPinnedNotes } from "@/store/slices/identitySlice";
import { __resetPinListWriteForTest, notePinListSeen, updatePinnedNotes } from "../pinListWrite";

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
  h.relayCfg = {};
  h.publishTargets = [];
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

  it("an unpin with no list anywhere publishes nothing — never an empty list", async () => {
    await updatePinnedNotes(h.pk, { id: id("1"), pin: false });
    expect(h.published).toHaveLength(0);
  });

  it("waits for a slow relay instead of settling on the first empty answer", async () => {
    vi.useFakeTimers();
    // The app relay answers at once with nothing; the other relay holds the
    // list (another client's pins) and answers 2 s later.
    h.relayCfg["wss://other.test"] = { delayMs: 2_000, events: [pinList([["e", id("7")]], 900)] };
    h.relayCfg["wss://app.test"] = { events: [] };
    const run = updatePinnedNotes(h.pk, { id: id("1"), pin: true });
    await vi.advanceTimersByTimeAsync(2_500);
    await run;
    expect(h.published[0].tags).toEqual([["e", id("7")], ["e", id("1"), "wss://app.test"]]);
  });

  it("a relay's repeated EOSE does not count as every relay answering", async () => {
    vi.useFakeTimers();
    h.relayCfg["wss://app.test"] = { events: [], eoses: 2 };
    h.relayCfg["wss://other.test"] = { delayMs: 1_500, events: [pinList([["e", id("7")]], 900)] };
    const run = updatePinnedNotes(h.pk, { id: id("1"), pin: true });
    await vi.advanceTimersByTimeAsync(2_000);
    await run;
    expect(h.published[0].tags[0]).toEqual(["e", id("7")]);
  });

  it("publishes only to the relays that answered the read", async () => {
    vi.useFakeTimers();
    h.relayCfg["wss://other.test"] = { answer: false };
    const run = updatePinnedNotes(h.pk, { id: id("1"), pin: true });
    await vi.advanceTimersByTimeAsync(7_000);
    await run;
    expect(h.publishTargets).toEqual([["wss://app.test"]]);
  });

  it("ignores a copy with a bad signature or a far-future date", async () => {
    const forged = { ...pinList([["e", id("1")]], 900), tags: [["e", id("9")]] };
    const future = pinList([["e", id("8")]], Math.floor(Date.now() / 1000) + 86_400);
    const real = pinList([["e", id("2")]], 800);
    h.relayEvents = [forged, future, real];
    await updatePinnedNotes(h.pk, { id: id("3"), pin: true });
    expect(h.published[0].tags).toEqual([["e", id("2")], ["e", id("3"), "wss://app.test"]]);
    expect(h.published[0].created_at).toBeLessThan(Math.floor(Date.now() / 1000) + 60);
  });

  it("builds on the copy seen at login when the write's own read misses it", async () => {
    const seen = pinList([["e", id("7")], ["a", `30023:${"b".repeat(64)}:essay`]], 900, "priv");
    expect(notePinListSeen(seen as never, h.pk)).toBe(true);
    h.relayEvents = []; // answers, holds nothing (the copy lives elsewhere)
    await updatePinnedNotes(h.pk, { id: id("1"), pin: true });
    expect(h.published[0].tags).toEqual([
      ["e", id("7")],
      ["a", `30023:${"b".repeat(64)}:essay`],
      ["e", id("1"), "wss://app.test"],
    ]);
    expect(h.published[0].content).toBe("priv");
  });

  it("does not remember an unverified or foreign copy from login", () => {
    const forged = { ...pinList([["e", id("1")]], 900), tags: [["e", id("9")]] };
    expect(notePinListSeen(forged as never, h.pk)).toBe(false);
    const other = finalizeEvent({ kind: 10001, created_at: 900, tags: [], content: "" }, generateSecretKey());
    expect(notePinListSeen(other as never, h.pk)).toBe(false);
  });

  it("a failed tap does not block the next one", async () => {
    h.accept = false;
    await expect(updatePinnedNotes(h.pk, { id: id("1"), pin: true })).rejects.toThrow();
    h.accept = true;
    await updatePinnedNotes(h.pk, { id: id("2"), pin: true });
    expect(h.published[h.published.length - 1]?.tags).toEqual([["e", id("2"), "wss://app.test"]]);
  });
});

describe("optimistic pin state", () => {
  it("an optimistic flip keeps the list's created_at, so the real list still lands", () => {
    store.dispatch(setPinnedNotes({ noteIds: [], createdAt: 900 }));
    store.dispatch(applyPinnedNoteOp({ id: id("1"), pin: true }));
    expect(store.getState().identity.pinnedNoteIds).toEqual([id("1")]);
    expect(store.getState().identity.pinnedNotesCreatedAt).toBe(900);
    // The relay's copy (same created_at, more pins) is adopted, not ignored.
    store.dispatch(setPinnedNotes({ noteIds: [id("7"), id("1")], createdAt: 900 }));
    expect(store.getState().identity.pinnedNoteIds).toEqual([id("7"), id("1")]);
  });

  it("the inverse op undoes a flip", () => {
    store.dispatch(setPinnedNotes({ noteIds: [id("1"), id("2")], createdAt: 900 }));
    store.dispatch(applyPinnedNoteOp({ id: id("1"), pin: false }));
    expect(store.getState().identity.pinnedNoteIds).toEqual([id("2")]);
    store.dispatch(applyPinnedNoteOp({ id: id("1"), pin: true }));
    expect(store.getState().identity.pinnedNoteIds).toEqual([id("2"), id("1")]);
  });
});
