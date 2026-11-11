import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GiftWrapRejectedError } from "@ishtarservices/core";

// A gift wrap is marked in the dedup LRU before it is decrypted. When the
// decrypt fails for a reason that can clear up (signer not ready, bunker
// timeout) the wrap must be unmarked so a NIP-77 re-request or a copy from
// another relay gets a second decrypt; when core has judged the wrap and
// refused it, a second copy must still be dropped without another decrypt.
const unwrapSpy = vi.fn();
vi.mock("@/lib/nostr/giftWrap", () => ({
  unwrapGiftWrap: (...a: unknown[]) => unwrapSpy(...a),
}));

import { processIncomingEvent, resetEventPipelineCaches } from "../eventPipeline";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import type { NostrEvent } from "@/types/nostr";

const ME = "a".repeat(64);
const WS = "wss://relay.example";

function wrapFor(me: string, id = "c".repeat(64)): NostrEvent {
  return {
    id,
    pubkey: "e".repeat(64),
    created_at: Math.floor(Date.now() / 1000) - 60,
    kind: 1059,
    tags: [["p", me]],
    content: "ciphertext",
    sig: "0".repeat(128),
  };
}

async function deliverTwice(event: NostrEvent): Promise<void> {
  await processIncomingEvent(event, WS);
  await vi.waitFor(() => expect(unwrapSpy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  await processIncomingEvent(event, "wss://other.relay");
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  store.dispatch(resetAll());
  resetEventPipelineCaches();
  unwrapSpy.mockReset();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
});

afterEach(() => {
  resetEventPipelineCaches();
});

describe("eventPipeline — gift wrap decrypt failures and the dedup LRU", () => {
  it("a transient decrypt failure unmarks the wrap, so a second copy is decrypted again", async () => {
    unwrapSpy.mockRejectedValue(new Error("NIP-46 request timed out"));
    await deliverTwice(wrapFor(ME));
    expect(unwrapSpy).toHaveBeenCalledTimes(2);
  });

  it("a wrap core refused (bad seal, wrong kind, expired) stays marked: a second copy is not decrypted", async () => {
    unwrapSpy.mockRejectedValue(new GiftWrapRejectedError("seal_sig", "Seal signature invalid"));
    await deliverTwice(wrapFor(ME, "d".repeat(64)));
    expect(unwrapSpy).toHaveBeenCalledTimes(1);
    // …and the NIP-77 reconcile (which filters on the slice's processed set) stops asking for it.
    expect(store.getState().dm.processedWrapIdSet["d".repeat(64)]).toBe(true);
  });

  it("a transiently failed wrap is NOT marked processed, so the reconcile can re-request it", async () => {
    unwrapSpy.mockRejectedValue(new Error("Signing operation timed out"));
    await deliverTwice(wrapFor(ME, "e".repeat(64)));
    expect(store.getState().dm.processedWrapIdSet["e".repeat(64)]).toBeUndefined();
  });

  it("a wrap that unwrapped stays marked (the slice dedups by wrap id anyway)", async () => {
    unwrapSpy.mockResolvedValue({
      sender: "b".repeat(64), content: "hi", tags: [["p", ME]], createdAt: 1_700_000_000,
      wrapId: "f".repeat(64), rumorId: "1".repeat(64), kind: 14,
    });
    await deliverTwice(wrapFor(ME, "f".repeat(64)));
    expect(unwrapSpy).toHaveBeenCalledTimes(1);
  });

  it("judges expiry from the wrap's arrival, with a 60 s clock-skew allowance", async () => {
    unwrapSpy.mockRejectedValue(new GiftWrapRejectedError("expired", "Gift wrap expired"));
    const before = Math.floor(Date.now() / 1000);
    await processIncomingEvent(wrapFor(ME, "9".repeat(64)), WS);
    await vi.waitFor(() => expect(unwrapSpy).toHaveBeenCalled());
    const opts = unwrapSpy.mock.calls[0][1] as { now: number };
    expect(opts.now).toBeGreaterThanOrEqual(before - 60);
    expect(opts.now).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) - 60);
  });
});
