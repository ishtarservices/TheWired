/**
 * The media-key seal is signed by whichever signer is active. A session that
 * outlived its account (switch mid-call) used to seal its room key with the
 * NEXT account's key: every room participant learned the two accounts are
 * the same person, and dropped the envelope anyway (sender ≠ identity).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DMMediaKeyEnvelope } from "@ishtarservices/shared-types";

const h = vi.hoisted(() => ({
  wrap: vi.fn(async (..._a: unknown[]) => ({ wrap: { id: "w" } })),
  publish: vi.fn(),
}));
vi.mock("@/lib/nostr/giftWrap", () => ({
  buildRumor: vi.fn(async (from: string) => ({ pubkey: from })),
  createGiftWrappedDM: (...a: unknown[]) => h.wrap(...a),
}));
vi.mock("@/lib/nostr/relayManager", () => ({
  relayManager: {
    publish: (...a: unknown[]) => h.publish(...a),
    onReconnect: vi.fn(() => () => {}),
    subscribe: vi.fn(() => "sub"),
    closeSubscription: vi.fn(),
    getWriteRelays: vi.fn(() => []),
  },
}));
vi.mock("@/lib/nostr/dmRelayList", () => ({
  getDMRelaysForPublish: vi.fn(async () => ["wss://inbox.test"]),
  fallbackDMRelays: vi.fn(() => ["wss://fallback.test"]),
}));

import { sendMediaKey } from "../mediaKeySender";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";

const A = "a".repeat(64);
const B = "b".repeat(64);
const PEER = "c".repeat(64);
const ENV = { v: 1 } as unknown as DMMediaKeyEnvelope;

beforeEach(() => {
  store.dispatch(resetAll());
  h.wrap.mockClear();
  h.publish.mockClear();
});

describe("sendMediaKey", () => {
  it("seals and publishes when the session's account is the logged-in one", async () => {
    store.dispatch(login({ pubkey: A, signerType: "nip07" }));
    await sendMediaKey(PEER, ENV, A);
    expect(h.wrap).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledWith({ id: "w" }, ["wss://inbox.test"]);
  });

  it("refuses to seal for another account's session (account switched mid-call)", async () => {
    store.dispatch(login({ pubkey: B, signerType: "nip07" }));
    await expect(sendMediaKey(PEER, ENV, A)).rejects.toThrow(/Account changed/);
    expect(h.wrap).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("refuses when nobody is logged in", async () => {
    await expect(sendMediaKey(PEER, ENV, A)).rejects.toThrow(/Not logged in/);
    expect(h.wrap).not.toHaveBeenCalled();
  });
});
