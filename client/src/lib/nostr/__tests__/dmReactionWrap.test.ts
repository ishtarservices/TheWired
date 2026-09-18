import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NostrEvent } from "@/types/nostr";

// The pipeline's gift-wrap path is exercised for real (validate → dedup →
// verify (globally mocked) → decrypt queue → handleGiftWrap); only the NIP-44
// unwrap is stubbed so a fake wrap yields the typed rumor we want.
const mockUnwrap = vi.fn();
vi.mock("@/lib/nostr/giftWrap", () => ({
  unwrapGiftWrap: (...a: unknown[]) => mockUnwrap(...a),
}));

import { processIncomingEvent, resetEventPipelineCaches } from "../eventPipeline";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { addDMMessage } from "@/store/slices/dmSlice";

const WS = "wss://relay.example";
const ME = "a".repeat(64);
const PARTNER = "b".repeat(64);
const RUMOR = "c".repeat(64);
const hex64 = (n: number) => n.toString(16).padStart(64, "0");

function wrap(id: number): NostrEvent {
  return {
    id: hex64(id),
    pubkey: hex64(0xdead + id), // random throwaway key, as NIP-59 wraps use
    created_at: Math.floor(Date.now() / 1000) - 3600,
    kind: 1059,
    tags: [["p", ME]],
    content: "ciphertext",
    sig: "0".repeat(128),
  };
}

function rumor(over: {
  sender: string;
  type: string;
  emoji: string;
  wrapId: string;
  target?: string;
}) {
  return {
    sender: over.sender,
    content: over.emoji,
    tags: [
      ["type", over.type],
      ["e", over.target ?? RUMOR],
      ["p", over.sender === ME ? PARTNER : ME],
    ],
    createdAt: Math.floor(Date.now() / 1000) - 60,
    wrapId: over.wrapId,
    rumorId: hex64(0xf00 + over.wrapId.length),
  };
}

/** Let the decrypt queue's Promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const target = () => store.getState().dm.messages[PARTNER]?.[0];

beforeEach(() => {
  store.dispatch(resetAll());
  resetEventPipelineCaches();
  mockUnwrap.mockReset();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  store.dispatch(
    addDMMessage({
      partnerPubkey: PARTNER,
      myPubkey: ME,
      message: { id: "w", senderPubkey: PARTNER, content: "hey", createdAt: 1000, wrapId: "target-wrap", rumorId: RUMOR },
    }),
  );
});

afterEach(() => {
  resetEventPipelineCaches();
});

describe("typed DM reaction rumors through the pipeline", () => {
  it("dm_reaction from the partner adds their emoji to the message (no chat bubble)", async () => {
    mockUnwrap.mockResolvedValueOnce(rumor({ sender: PARTNER, type: "dm_reaction", emoji: "🔥", wrapId: "rx-1" }));
    await processIncomingEvent(wrap(1), WS);
    await settle();
    expect(target().reactions).toEqual({ "🔥": [PARTNER] });
    // Not rendered as a message.
    expect(store.getState().dm.messages[PARTNER]).toHaveLength(1);
    expect(store.getState().dm.contacts[0].lastMessagePreview).toBe("hey");
  });

  it("the self-wrap echo of our own optimistic reaction is applied at most once", async () => {
    // Optimistic dispatch (what reactToDM does) with the self-wrap id …
    store.dispatch({
      type: "dm/reactDMMessage",
      payload: { partnerPubkey: PARTNER, rumorId: RUMOR, emoji: "👍", reactorPubkey: ME, wrapId: "self-wrap" },
    });
    // … then the same wrap comes back from the relay.
    mockUnwrap.mockResolvedValueOnce(rumor({ sender: ME, type: "dm_reaction", emoji: "👍", wrapId: "self-wrap" }));
    await processIncomingEvent(wrap(2), WS);
    await settle();
    expect(target().reactions).toEqual({ "👍": [ME] });
  });

  it("dm_reaction_remove clears that reactor's emoji", async () => {
    mockUnwrap.mockResolvedValueOnce(rumor({ sender: PARTNER, type: "dm_reaction", emoji: "🔥", wrapId: "rx-a" }));
    await processIncomingEvent(wrap(3), WS);
    await settle();
    mockUnwrap.mockResolvedValueOnce(rumor({ sender: PARTNER, type: "dm_reaction_remove", emoji: "🔥", wrapId: "rx-b" }));
    await processIncomingEvent(wrap(4), WS);
    await settle();
    expect(target().reactions).toBeUndefined();
  });

  it("a reaction whose target hasn't arrived yet is held and applied when it does", async () => {
    const LATE = "d".repeat(64);
    mockUnwrap.mockResolvedValueOnce(rumor({ sender: PARTNER, type: "dm_reaction", emoji: "🎉", wrapId: "rx-early", target: LATE }));
    await processIncomingEvent(wrap(5), WS);
    await settle();
    expect(store.getState().dm.messages[PARTNER]).toHaveLength(1);
    // Now the plain message it targets arrives.
    mockUnwrap.mockResolvedValueOnce({
      sender: PARTNER,
      content: "late message",
      tags: [["p", ME]],
      createdAt: Math.floor(Date.now() / 1000) - 30,
      wrapId: "late-wrap",
      rumorId: LATE,
    });
    await processIncomingEvent(wrap(6), WS);
    await settle();
    const late = store.getState().dm.messages[PARTNER].find((m) => m.rumorId === LATE)!;
    expect(late.content).toBe("late message");
    expect(late.reactions).toEqual({ "🎉": [PARTNER] });
  });

  it("unknown typed rumors from newer clients are dropped, not rendered as messages", async () => {
    mockUnwrap.mockResolvedValueOnce(rumor({ sender: PARTNER, type: "dm_something_new", emoji: "??", wrapId: "rx-z" }));
    await processIncomingEvent(wrap(7), WS);
    await settle();
    expect(store.getState().dm.messages[PARTNER]).toHaveLength(1);
    expect(target().reactions).toBeUndefined();
  });
});
