import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  connect: vi.fn(),
  waitForConnection: vi.fn().mockResolvedValue(undefined),
  spaces: [] as Array<{ id: string; hostRelay: string; relayUrls?: string[] }>,
}));
vi.mock("@/lib/nostr/relayManager", () => ({
  relayManager: { connect: h.connect, waitForConnection: h.waitForConnection },
}));
vi.mock("@/store", () => ({ store: { getState: () => ({ spaces: { list: h.spaces } }) } }));

import { APP_RELAY } from "@/lib/nostr/constants";
import { spacePublishRelays, spacePublishRelaysForAll } from "../spacePublish";

beforeEach(() => {
  h.connect.mockClear();
  h.spaces = [
    { id: "a", hostRelay: "wss://host-a.example", relayUrls: ["wss://mirror-a.example"] },
    { id: "b", hostRelay: "wss://host-b.example" },
  ];
});

describe("spacePublishRelays", () => {
  it("returns the known space's host + mirrors and pre-connects them", async () => {
    expect(await spacePublishRelays("a")).toEqual(["wss://host-a.example", "wss://mirror-a.example"]);
    expect(h.connect).toHaveBeenCalledWith("wss://host-a.example", "read+write");
    expect(h.connect).toHaveBeenCalledWith("wss://mirror-a.example", "read+write");
  });

  it("falls back to the APP relay — never the default write relays — for an unknown space", async () => {
    // Returning undefined here used to send a members-only release to relay.damus.io et al.
    expect(await spacePublishRelays("gone")).toEqual([APP_RELAY]);
  });

  it("returns undefined only when no space id is given", async () => {
    expect(await spacePublishRelays(undefined)).toBeUndefined();
  });
});

describe("spacePublishRelaysForAll", () => {
  it("unions every listed space's relays, unknown ids contributing the app relay", async () => {
    expect(await spacePublishRelaysForAll(["a", "b", "gone", "a"])).toEqual([
      "wss://host-a.example",
      "wss://mirror-a.example",
      "wss://host-b.example",
      APP_RELAY,
    ]);
  });
  it("is undefined for an empty list (the publish chokepoint decides)", async () => {
    expect(await spacePublishRelaysForAll([])).toBeUndefined();
  });
});
