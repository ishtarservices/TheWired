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
    close: vi.fn(),
    getReconnectSince: vi.fn(),
  },
}));

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
} from "../groupSubscriptions";

const subscribe = vi.mocked(subscriptionManager.subscribe);
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
  close.mockReset();
  getReconnectSince.mockReset();
  let n = 0;
  subscribe.mockImplementation(() => `sub-${++n}`);
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
    expect(h1.filters[0].kinds).toEqual([9, 5, 9005]);
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
