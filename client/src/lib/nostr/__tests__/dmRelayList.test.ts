import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { NostrEvent } from "../../../types/nostr";

// --- Mocks (hoisted before dmRelayList imports them) ---

/** kind:10050 lists the mocked bootstrap relays hold, by author. */
const lists = new Map<string, string[]>();

vi.mock("../relayManager", () => ({
  relayManager: {
    // Answer like a relay: the author's list (if any), then EOSE — async, as
    // fetchDMRelayList reads the returned sub id inside onEOSE.
    subscribe: vi.fn((opts: { filters: { authors: string[] }[]; onEvent: (e: NostrEvent) => void; onEOSE: () => void }) => {
      const author = opts.filters[0].authors[0];
      queueMicrotask(() => {
        const relays = lists.get(author);
        if (relays) {
          opts.onEvent({
            id: "1".repeat(64), pubkey: author, created_at: 1, kind: 10050,
            tags: relays.map((r) => ["relay", r]), content: "", sig: "0".repeat(128),
          });
        }
        opts.onEOSE();
      });
      return "sub_test";
    }),
    closeSubscription: vi.fn(),
    connect: vi.fn(),
    connectPeer: vi.fn(),
    waitForConnection: vi.fn(async () => true),
    getWriteRelays: vi.fn(() => [{ url: "wss://write.example" }]),
  },
}));

/** The signed-in account's own kind-10050 list (identity.dmRelayList). */
let ownList: string[] = [];
vi.mock("../../../store", () => ({
  store: { getState: () => ({ identity: { dmRelayList: ownList } }) },
}));

import { getDMRelaysForPublish, fallbackDMRelays, clearDMRelayCache, selfWrapTargets, recipientTargets as dmRecipientTargets } from "../dmRelayList";
import { relayManager } from "../relayManager";
import { APP_RELAY } from "../constants";
import { normalizeRelayUrl } from "../relayUrl";

const subscribeMock = relayManager.subscribe as unknown as Mock;
const connectMock = relayManager.connect as unknown as Mock;
const connectPeerMock = relayManager.connectPeer as unknown as Mock;

const APP = normalizeRelayUrl(APP_RELAY) ?? APP_RELAY;
const PEER = "b".repeat(64);
const TEN_MINUTES = 10 * 60 * 1000;

/** What dmService / projectKeySender hand to relayManager.publish. */
async function recipientTargets(to: string): Promise<string[]> {
  return (await getDMRelaysForPublish(to)) ?? fallbackDMRelays();
}

describe("getDMRelaysForPublish — recipient wraps always reach the platform relay", () => {
  beforeEach(() => {
    lists.clear();
    clearDMRelayCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds APP_RELAY when the recipient's kind:10050 omits it", async () => {
    lists.set(PEER, ["wss://inbox.example", "wss://inbox2.example"]);
    const targets = await recipientTargets(PEER);
    expect(targets).toEqual(["wss://inbox.example", "wss://inbox2.example", APP]);
    // Their own inbox relays are still dialed before publishing — and so is
    // the platform relay, so its copy is not lost mid-reconnect.
    // Recipient-chosen relays are dialed peer-only (no AUTH as the user);
    // the platform relay is ours and AUTHs as usual.
    expect(connectPeerMock).toHaveBeenCalledWith("wss://inbox.example");
    expect(connectPeerMock).toHaveBeenCalledWith("wss://inbox2.example");
    expect(connectMock).toHaveBeenCalledWith(APP);
    expect(connectMock).not.toHaveBeenCalledWith("wss://inbox.example");
    expect(relayManager.waitForConnection).toHaveBeenCalledWith(APP, 3000);
  });

  it("does not duplicate APP_RELAY when the list already names it (any trailing-slash form)", async () => {
    lists.set(PEER, ["wss://inbox.example", APP + "/"]);
    const targets = await recipientTargets(PEER);
    expect(targets.filter((u) => u === APP)).toHaveLength(1);
    expect(targets).toHaveLength(2);
  });

  it("leaves the no-list fallback unchanged (write relays + APP_RELAY)", async () => {
    expect(await getDMRelaysForPublish(PEER)).toBeUndefined();
    expect(await recipientTargets(PEER)).toEqual(["wss://write.example", APP_RELAY]);
  });

  it("re-fetches a cached list after 10 minutes, not before", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    lists.set(PEER, ["wss://old.example"]);
    expect(await recipientTargets(PEER)).toContain("wss://old.example");

    lists.set(PEER, ["wss://new.example"]);
    vi.setSystemTime(Date.now() + TEN_MINUTES - 1000);
    expect(await recipientTargets(PEER)).toContain("wss://old.example");
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2000);
    const targets = await recipientTargets(PEER);
    expect(subscribeMock).toHaveBeenCalledTimes(2);
    expect(targets).toEqual(["wss://new.example", APP]);
  });
});

describe("selfWrapTargets / recipientTargets — the DM send sets", () => {
  beforeEach(() => {
    ownList = [];
    lists.clear();
    clearDMRelayCache();
  });

  it("self-wrap: own list plus the platform relay, deduped by normalized URL (trailing slash)", () => {
    ownList = ["wss://own.example", APP + "/"];
    const t = selfWrapTargets();
    expect(t.map((u) => normalizeRelayUrl(u) ?? u)).toEqual(["wss://own.example", APP]);
    expect(t).toHaveLength(2);
  });

  it("self-wrap without an own list: the fallback set (write relays + platform relay), no duplicate", () => {
    const t = selfWrapTargets();
    expect(t.map((u) => normalizeRelayUrl(u) ?? u)).toEqual(["wss://write.example", APP]);
  });

  it("recipient with a list: every inbox relay counts; without one: only the platform relay counts", async () => {
    lists.set(PEER, ["wss://inbox.example"]);
    const withList = await dmRecipientTargets(PEER);
    expect(withList.targets).toEqual(["wss://inbox.example", APP]);
    expect(withList.countAs).toEqual(withList.targets);
    const noList = await dmRecipientTargets("c".repeat(64));
    expect(noList.targets.map((u) => normalizeRelayUrl(u) ?? u)).toEqual(["wss://write.example", APP]);
    expect(noList.countAs).toEqual([APP]);
  });
});
