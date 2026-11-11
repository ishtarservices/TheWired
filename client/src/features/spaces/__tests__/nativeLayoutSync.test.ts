/**
 * Relay-only (NIP-29-native) spaces: which kind:30078 layout is binding.
 * Relays return newest first and the admin list (39001) may arrive after the
 * layout, so the choice must not depend on arrival order.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";

vi.mock("@/store", async () => {
  const { createTestStore } = await import("@/__tests__/helpers/createTestStore");
  return { store: createTestStore() };
});

import { store } from "@/store";
import { setSpaces } from "@/store/slices/spacesSlice";
import type { NostrEvent } from "@/types/nostr";
import type { Space, SpaceChannel } from "@/types/space";
import { applyNativeLayoutEvent, applyNativeGroupEvent, forgetNativeLayout, appliedLayoutCreatedAt } from "../nip29SpaceSync";
import { buildLayoutEvent } from "../channelLayout";

const G = "g1";
const CREATOR = "c".repeat(64);
const ADMIN = "a".repeat(64);
const RELAY = "r".repeat(64);
const STRANGER = "s".repeat(64);

function space(overrides: Partial<Space> = {}): Space {
  return {
    id: G,
    hostRelay: "wss://groups.example.com",
    name: "G",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    mode: "read-write",
    creatorPubkey: CREATOR,
    createdAt: 0,
    spaceType: "nip29-native",
    relayPubkey: RELAY,
    ...overrides,
  };
}

const chan = (id: string, label: string): SpaceChannel => ({
  id,
  spaceId: G,
  type: "chat",
  label,
  position: 0,
  isDefault: false,
  adminOnly: false,
  slowModeSeconds: 0,
  feedMode: "all",
});

function layoutEvent(author: string, label: string, createdAt: number, id: string): NostrEvent {
  const unsigned = buildLayoutEvent(author, G, { channels: [chan("chat", label)], categories: [] }, createdAt);
  return { ...unsigned, pubkey: author, id, sig: "sig" };
}

const shownLabel = () => store.getState().spaces.channels[G]?.[0]?.label;

beforeEach(() => {
  forgetNativeLayout(G);
  store.dispatch(setSpaces([space()]));
  store.dispatch({ type: "spaces/setChannels", payload: { spaceId: G, channels: [] } });
});

describe("native layout selection", () => {
  it("keeps the newest layout even when an older one arrives later", () => {
    expect(applyNativeLayoutEvent(layoutEvent(CREATOR, "#new", 200, "e2"))).toBe(true);
    expect(shownLabel()).toBe("#new");
    applyNativeLayoutEvent(layoutEvent(CREATOR, "#old", 100, "e1"));
    expect(shownLabel()).toBe("#new");
    expect(appliedLayoutCreatedAt(G)).toBe(200);
  });

  it("ignores a stranger's layout, however new", () => {
    applyNativeLayoutEvent(layoutEvent(CREATOR, "#mine", 100, "e1"));
    applyNativeLayoutEvent(layoutEvent(STRANGER, "#forged", 999, "e9"));
    expect(shownLabel()).toBe("#mine");
  });

  it("applies an admin's layout that arrived before the admin list once 39001 names them", () => {
    applyNativeLayoutEvent(layoutEvent(CREATOR, "#creator", 100, "e1"));
    applyNativeLayoutEvent(layoutEvent(ADMIN, "#admin-newer", 300, "e3"));
    expect(shownLabel()).toBe("#creator"); // ADMIN not known yet
    applyNativeGroupEvent({
      id: "adm",
      pubkey: RELAY,
      kind: 39001,
      created_at: 1,
      tags: [["d", G], ["p", ADMIN]],
      content: "",
      sig: "sig",
    });
    expect(shownLabel()).toBe("#admin-newer");
  });

  it("does not apply layouts to platform spaces", () => {
    store.dispatch(setSpaces([space({ spaceType: "platform" })]));
    expect(applyNativeLayoutEvent(layoutEvent(CREATOR, "#x", 100, "e1"))).toBe(false);
  });
});
