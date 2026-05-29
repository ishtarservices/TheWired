import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// --- Mocks (hoisted) ---

vi.mock("../relayManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../relayManager")>();
  return {
    ...actual, // keep isIndexerSafe + INDEXER_URL_SET real
    relayManager: {
      subscribe: vi.fn(),
      closeSubscription: vi.fn(),
      getReadRelays: vi.fn(() => []),
    },
  };
});

vi.mock("../eventPipeline", () => ({
  processIncomingEvent: vi.fn(),
}));

import { subscriptionManager } from "../subscriptionManager";
import { relayManager } from "../relayManager";

const relaySubMock = relayManager.subscribe as unknown as Mock;
const relayCloseMock = relayManager.closeSubscription as unknown as Mock;
const getReadRelaysMock = relayManager.getReadRelays as unknown as Mock;

const LOCAL = "ws://localhost:7777";
const DAMUS = "wss://relay.damus.io";
const PURPLEPAG = "wss://purplepag.es";
const KINDPAG = "wss://user.kindpag.es";

/** The opts most recently passed to relayManager.subscribe. */
function lastSubOpts() {
  const calls = relaySubMock.mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.useRealTimers();
  relaySubMock.mockReset().mockReturnValue("relayman-sub");
  relayCloseMock.mockReset();
  getReadRelaysMock.mockReset().mockReturnValue([]);
});

describe("subscriptionManager EOSE quorum", () => {
  it("fires onEOSE once every tracked relay has EOSEd", () => {
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [1], authors: ["a".repeat(64)] }],
      relayUrls: [LOCAL, DAMUS],
      onEOSE,
    });

    const opts = lastSubOpts();
    opts.onEOSE("sub", LOCAL);
    expect(onEOSE).not.toHaveBeenCalled(); // need DAMUS too
    opts.onEOSE("sub", DAMUS);
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("does NOT wait on indexer relays for non-indexer-safe filters", () => {
    // kind:[1] is NOT in {0,3,10002} — relayManager will strip the indexers.
    // subscriptionManager must mirror that or it'd wait forever for EOSEs
    // from relays that were never actually subscribed. (This was the real bug:
    // own-profile notes spinner stuck forever because purplepag/kindpag never EOSEd.)
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [1, 6], authors: ["a".repeat(64)], limit: 50 }],
      relayUrls: [LOCAL, PURPLEPAG, KINDPAG, DAMUS],
      onEOSE,
    });

    const opts = lastSubOpts();
    opts.onEOSE("sub", LOCAL);
    opts.onEOSE("sub", DAMUS);
    // Indexers neither received the REQ nor will EOSE — but onEOSE must fire.
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("ignores EOSE arriving from an untracked (stripped) relay", () => {
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [1] }],
      relayUrls: [LOCAL, DAMUS, PURPLEPAG],
      onEOSE,
    });

    const opts = lastSubOpts();
    // A late-forwarded EOSE from a stripped indexer should never flip the quorum.
    opts.onEOSE("sub", PURPLEPAG);
    expect(onEOSE).not.toHaveBeenCalled();
    // Real tracked EOSEs still resolve normally.
    opts.onEOSE("sub", LOCAL);
    opts.onEOSE("sub", DAMUS);
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("tracks indexer relays for profile-kind filters (kind:0/3/10002)", () => {
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [0], authors: ["a".repeat(64)] }],
      relayUrls: [LOCAL, PURPLEPAG],
      onEOSE,
    });

    const opts = lastSubOpts();
    opts.onEOSE("sub", LOCAL);
    expect(onEOSE).not.toHaveBeenCalled(); // need PURPLEPAG too — it's tracked now
    opts.onEOSE("sub", PURPLEPAG);
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("fires onEOSE via backstop timeout when a tracked relay never EOSEs", () => {
    vi.useFakeTimers();
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [1] }],
      relayUrls: [LOCAL, DAMUS],
      onEOSE,
    });

    const opts = lastSubOpts();
    opts.onEOSE("sub", LOCAL); // only one EOSE arrives
    expect(onEOSE).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_001);
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — fires onEOSE only once even when both paths trigger", () => {
    vi.useFakeTimers();
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [1] }],
      relayUrls: [LOCAL, DAMUS],
      onEOSE,
    });

    const opts = lastSubOpts();
    opts.onEOSE("sub", LOCAL);
    opts.onEOSE("sub", DAMUS); // all-EOSE fires
    vi.advanceTimersByTime(5_001); // backstop would also fire, but…
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("close() cancels the backstop timer (no late onEOSE)", () => {
    vi.useFakeTimers();
    const onEOSE = vi.fn();
    const subId = subscriptionManager.subscribe({
      filters: [{ kinds: [1] }],
      relayUrls: [LOCAL, DAMUS],
      onEOSE,
    });

    subscriptionManager.close(subId);
    vi.advanceTimersByTime(10_000);
    expect(onEOSE).not.toHaveBeenCalled();
    expect(relayCloseMock).toHaveBeenCalled();
  });

  it("fires onEOSE immediately when every requested relay was stripped", async () => {
    // All targeted relays are indexers AND the filter is non-indexer-safe →
    // trackedUrls becomes empty. The microtask backstop should fire onEOSE
    // synchronously enough that the UI never sticks on "loading".
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [1] }],
      relayUrls: [PURPLEPAG, KINDPAG], // all indexers → stripped
      onEOSE,
    });

    await Promise.resolve(); // flush the queueMicrotask
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });

  it("falls through to getReadRelays() when no relayUrls supplied", () => {
    getReadRelaysMock.mockReturnValue([{ url: LOCAL }, { url: DAMUS }]);
    const onEOSE = vi.fn();
    subscriptionManager.subscribe({
      filters: [{ kinds: [1] }],
      onEOSE,
    });

    expect(lastSubOpts().relayUrls).toEqual([LOCAL, DAMUS]);
    const opts = lastSubOpts();
    opts.onEOSE("sub", LOCAL);
    opts.onEOSE("sub", DAMUS);
    expect(onEOSE).toHaveBeenCalledTimes(1);
  });
});
