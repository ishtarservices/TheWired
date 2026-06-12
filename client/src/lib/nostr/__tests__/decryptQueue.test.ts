import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NostrEvent } from "@/types/nostr";

let signerType = "nip46";
vi.mock("@/store", () => ({
  store: { getState: () => ({ identity: { signerType } }) },
}));

import { DecryptQueue } from "../decryptQueue";

function ev(id: string): NostrEvent {
  return { id, pubkey: "p".repeat(64), created_at: 1, kind: 1059, tags: [], content: "", sig: "s" };
}

// Fresh instance per test so in-flight `active` state never leaks across cases.
let decryptQueue: DecryptQueue;
beforeEach(() => {
  decryptQueue = new DecryptQueue();
  decryptQueue.setHandler(() => {});
  signerType = "nip46";
});

describe("decryptQueue", () => {
  it("runs at most `concurrency` handlers at once (nip46 → 1)", async () => {
    let active = 0;
    let maxActive = 0;
    const gates: Array<() => void> = [];
    decryptQueue.setHandler(
      () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          gates.push(() => {
            active--;
            resolve();
          });
        }),
    );

    decryptQueue.submit(ev("a"));
    decryptQueue.submit(ev("b"));
    decryptQueue.submit(ev("c"));
    await Promise.resolve();
    expect(maxActive).toBe(1); // serialized — a NIP-46 bunker isn't flooded

    while (gates.length) {
      gates.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(maxActive).toBe(1);
  });

  it("a local keystore signer runs several concurrently (tauri → 4)", async () => {
    signerType = "tauri_keystore";
    let active = 0;
    let maxActive = 0;
    const gates: Array<() => void> = [];
    decryptQueue.setHandler(
      () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          gates.push(() => {
            active--;
            resolve();
          });
        }),
    );

    for (let i = 0; i < 6; i++) decryptQueue.submit(ev(`e${i}`));
    await Promise.resolve();
    expect(maxActive).toBe(4); // capped at the tauri concurrency
    gates.forEach((g) => g());
  });

  it("rejects submits past MAX_PENDING (returns false)", () => {
    decryptQueue.setHandler(() => new Promise<void>(() => {})); // never resolves
    let last = true;
    for (let i = 0; i < 400; i++) last = decryptQueue.submit(ev(`e${i}`));
    expect(last).toBe(false); // saturated → caller unmarks for retry
  });

  it("clear() drops queued wraps (account switch)", async () => {
    let ran = 0;
    decryptQueue.setHandler(() => new Promise<void>(() => { ran++; })); // first one starts
    decryptQueue.submit(ev("a"));
    decryptQueue.submit(ev("b"));
    decryptQueue.submit(ev("c"));
    decryptQueue.clear();
    expect(decryptQueue.pendingCount).toBe(0);
    // only the first ever started (concurrency 1); b/c were dropped by clear()
    expect(ran).toBe(1);
  });
});
