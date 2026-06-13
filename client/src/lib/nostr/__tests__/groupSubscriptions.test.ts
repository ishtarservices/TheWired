import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Space } from "@/types/space";

// Capture the reconnect callback registered at module load (hoisted so the
// vi.mock factory can assign into it).
const hoisted = vi.hoisted(() => ({
  reconnectCb: undefined as ((url: string) => void) | undefined,
}));

vi.mock("../subscriptionManager", () => ({
  subscriptionManager: {
    subscribe: vi.fn(),
    subscribeOnce: vi.fn(),
    close: vi.fn(),
    getReconnectSince: vi.fn(),
  },
}));

// flushEventPipeline is called by loadMore* after an all-eose; stub it out.
vi.mock("../eventPipeline", () => ({ flushEventPipeline: vi.fn() }));

vi.mock("../relayManager", () => ({
  relayManager: {
    onReconnect: (cb: (url: string) => void) => {
      hoisted.reconnectCb = cb;
      return () => {};
    },
  },
}));

import { subscriptionManager } from "../subscriptionManager";
import {
  startBackgroundChatSubs,
  openBgChatSub,
  closeBgChatSub,
  stopAllBgChatSubs,
  switchSpaceChannel,
  refreshSpaceFeed,
  loadMoreSpaceFeed,
  enterSpace,
} from "../groupSubscriptions";
import { store, resetAll } from "@/store";
import { setActiveChannel, setChannelSubscription } from "@/store/slices/spacesSlice";
import { trackFeedTimestamp } from "@/store/slices/feedSlice";

const subscribe = vi.mocked(subscriptionManager.subscribe);
const subscribeOnce = vi.mocked(subscriptionManager.subscribeOnce);
const close = vi.mocked(subscriptionManager.close);
const getReconnectSince = vi.mocked(subscriptionManager.getReconnectSince);

function space(id: string, hostRelay: string): Space {
  return {
    id,
    hostRelay,
    name: id,
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    mode: "read-write",
    creatorPubkey: "pk",
    createdAt: 0,
  };
}

/** Extract the filter object passed to a given subscribe() call. */
function filterOf(callIndex: number) {
  return (subscribe.mock.calls[callIndex][0] as {
    filters: { kinds: number[]; "#h": string[]; since: number }[];
    relayUrls: string[];
  });
}

beforeEach(() => {
  stopAllBgChatSubs(); // clear module state carried over from a prior test
  subscribe.mockReset();
  subscribeOnce.mockReset();
  close.mockReset();
  getReconnectSince.mockReset();
  let n = 0;
  subscribe.mockImplementation(() => `sub-${++n}`);
  subscribeOnce.mockResolvedValue({ reason: "all-eose" });
});

describe("groupSubscriptions — bg chat sub collapse", () => {
  it("opens one sub per host relay carrying all that host's space ids in #h", () => {
    startBackgroundChatSubs([
      space("A", "wss://host1"),
      space("B", "wss://host1"),
      space("C", "wss://host2"),
    ]);
    expect(subscribe).toHaveBeenCalledTimes(2);

    const byHost = subscribe.mock.calls.map((c) => c[0] as ReturnType<typeof filterOf>);
    const h1 = byHost.find((o) => o.relayUrls[0] === "wss://host1")!;
    const h2 = byHost.find((o) => o.relayUrls[0] === "wss://host2")!;

    expect([...h1.filters[0]["#h"]].sort()).toEqual(["A", "B"]);
    expect(h2.filters[0]["#h"]).toEqual(["C"]);
    expect(h1.filters[0].kinds).toEqual([9, 1068, 5, 9005]);
  });

  it("collapses many spaces on one host into a single subscription", () => {
    const spaces = Array.from({ length: 27 }, (_, i) => space(`s${i}`, "wss://host"));
    startBackgroundChatSubs(spaces);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(filterOf(0).filters[0]["#h"]).toHaveLength(27);
  });

  it("skips spaces with no hostRelay", () => {
    startBackgroundChatSubs([space("A", ""), space("B", "wss://host")]);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(filterOf(0).filters[0]["#h"]).toEqual(["B"]);
  });

  it("adds a joined space to its host sub (close + reopen with the new id)", () => {
    startBackgroundChatSubs([space("A", "wss://host1")]);
    subscribe.mockClear();
    close.mockClear();

    openBgChatSub(space("B", "wss://host1"));

    expect(close).toHaveBeenCalledTimes(1); // old host sub closed
    expect(subscribe).toHaveBeenCalledTimes(1); // reopened
    expect([...filterOf(0).filters[0]["#h"]].sort()).toEqual(["A", "B"]);
  });

  it("is idempotent — re-adding the same space does nothing", () => {
    startBackgroundChatSubs([space("A", "wss://host1")]);
    subscribe.mockClear();
    close.mockClear();

    openBgChatSub(space("A", "wss://host1"));

    expect(subscribe).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("removing a space reopens its host sub without that id", () => {
    startBackgroundChatSubs([space("A", "wss://h"), space("B", "wss://h")]);
    subscribe.mockClear();
    close.mockClear();

    closeBgChatSub("A");

    expect(close).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(filterOf(0).filters[0]["#h"]).toEqual(["B"]);
  });

  it("removing the last space on a host closes the sub entirely", () => {
    startBackgroundChatSubs([space("A", "wss://h")]);
    subscribe.mockClear();
    close.mockClear();

    closeBgChatSub("A");

    expect(close).toHaveBeenCalledTimes(1);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("stopAll closes every host sub", () => {
    startBackgroundChatSubs([space("A", "wss://h1"), space("B", "wss://h2")]);
    close.mockClear();
    stopAllBgChatSubs();
    expect(close).toHaveBeenCalledTimes(2);
  });
});

describe("groupSubscriptions — reconnect since freshness", () => {
  it("rebuilds a host sub with a fresh since on reconnect", async () => {
    startBackgroundChatSubs([space("A", "wss://h")]);
    subscribe.mockClear();
    close.mockClear();
    getReconnectSince.mockReturnValue(1234);

    hoisted.reconnectCb?.("wss://h"); // rebuild is deferred to a microtask
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1); // stale sub closed
    expect(subscribe).toHaveBeenCalledTimes(1); // reopened fresh
    expect(filterOf(0).filters[0].since).toBe(1234);
    expect(filterOf(0).filters[0]["#h"]).toEqual(["A"]);
  });

  it("a reconnect for a host with no bg sub is a no-op", async () => {
    hoisted.reconnectCb?.("wss://unknown");
    await Promise.resolve();
    expect(subscribe).not.toHaveBeenCalled();
  });
});

// ── Subscription leak fixes (Phase 3a, Part A) ──────────────────────────────
describe("groupSubscriptions — channel-switch leak (#38)", () => {
  beforeEach(() => {
    store.dispatch(resetAll());
    let n = 0;
    subscribe.mockImplementation(() => `sub-${++n}`);
  });

  it("closes the previous channel's sub on switch, and never the bg chat sub", () => {
    // A prior channel sub for spaceA lives in Redux; a bg chat sub lives in the
    // module map (hostRelaySubs), NOT Redux.
    store.dispatch(setChannelSubscription({ channelId: "spaceA:chan1", subId: "old-sub" }));
    startBackgroundChatSubs([space("spaceA", "wss://h")]); // bg sub → "sub-1"
    // The caller overwrites activeChannelId to the NEW channel BEFORE switching —
    // this is exactly the condition that made the old sub unrecoverable (#38).
    store.dispatch(setActiveChannel("spaceA:chan2"));

    const sp = space("spaceA", "wss://h");
    sp.memberPubkeys = ["pk1"];
    switchSpaceChannel(sp, "notes", "chan2");

    // PRE-fix: the fn read the already-overwritten activeChannelId, so "old-sub"
    // was never closed (the leak). POST-fix it prefix-closes the space's subs.
    expect(close).toHaveBeenCalledWith("old-sub");
    expect(store.getState().spaces.subscriptions["spaceA:chan1"]).toBeUndefined();
    // The always-on bg chat sub is in hostRelaySubs, not Redux, so it survives.
    expect(close).not.toHaveBeenCalledWith("sub-1");
  });
});

describe("groupSubscriptions — refresh-feed leak", () => {
  beforeEach(() => {
    store.dispatch(resetAll());
  });

  it("uses the auto-closing subscribeOnce so the refresh sub can't leak", () => {
    const sp = space("spaceR", "wss://h");
    sp.memberPubkeys = ["pk1"];

    refreshSpaceFeed(sp, "notes");

    // PRE-fix: a manual subscribe()+onEOSE that forgot to close → the sub
    // streamed forever. POST-fix: subscribeOnce guarantees close on every path
    // (EOSE / timeout / no-relays), structurally eliminating the leak class.
    expect(subscribeOnce).toHaveBeenCalledTimes(1);
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe("groupSubscriptions — stale *MetaSubs after account switch (A4)", () => {
  beforeEach(() => {
    store.dispatch(resetAll());
    let n = 0;
    subscribe.mockImplementation(() => `sub-${++n}`);
  });

  it("re-subscribes space metadata for a new account after teardown", () => {
    enterSpace("grp", "wss://h");
    expect(subscribe).toHaveBeenCalledTimes(2); // metadata + layout

    // Same session, no teardown → idempotent early-return (correct).
    subscribe.mockClear();
    enterSpace("grp", "wss://h");
    expect(subscribe).not.toHaveBeenCalled();

    // Teardown (logout / account switch). PRE-fix this left spaceMetaSubs/
    // spaceLayoutSubs populated, so the next enterSpace early-returned and
    // metadata silently never re-subscribed for the new account.
    stopAllBgChatSubs();
    subscribe.mockClear();
    enterSpace("grp", "wss://h");
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});

describe("groupSubscriptions — loadMore hasMore on timeout vs all-eose (#78)", () => {
  beforeEach(() => {
    store.dispatch(resetAll());
  });

  it("a TIMEOUT must NOT conclude 'no more' — leaves hasMore true", async () => {
    const sp = space("spaceP", "wss://h");
    sp.memberPubkeys = ["pk1"];
    const contextId = "spaceP:notes";
    store.dispatch(trackFeedTimestamp({ contextId, createdAt: 1000 })); // oldestAt=1000
    subscribeOnce.mockResolvedValue({ reason: "timeout" });

    loadMoreSpaceFeed(sp, "notes");
    await Promise.resolve();
    await Promise.resolve();

    // PRE-fix: ANY EOSE (incl. the backstop timeout) flipped hasMore off, falsely
    // ending pagination after a slow relay. POST-fix: only all-eose can.
    expect(store.getState().feed.meta[contextId].hasMore).toBe(true);
  });

  it("an ALL-EOSE with no older events concludes hasMore false", async () => {
    const sp = space("spaceQ", "wss://h");
    sp.memberPubkeys = ["pk1"];
    const contextId = "spaceQ:notes";
    store.dispatch(trackFeedTimestamp({ contextId, createdAt: 1000 }));
    subscribeOnce.mockResolvedValue({ reason: "all-eose" });

    loadMoreSpaceFeed(sp, "notes");
    await Promise.resolve();
    await Promise.resolve();

    // flushEventPipeline is mocked → oldestAt unchanged → honest end-of-feed.
    expect(store.getState().feed.meta[contextId].hasMore).toBe(false);
  });
});
