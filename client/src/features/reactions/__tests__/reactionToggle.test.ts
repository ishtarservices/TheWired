import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UnsignedEvent } from "@/types/nostr";

const mockSignAndPublish = vi.fn();
vi.mock("@/lib/nostr/publish", () => ({
  signAndPublish: (...a: unknown[]) => mockSignAndPublish(...a),
}));
import { store, resetAll } from "@/store";
import { relayManager } from "@/lib/nostr/relayManager";
import { addReaction, selectReactionCount, selectMyReaction } from "@/store/slices/reactionsSlice";
import {
  toggleReaction,
  toggleLike,
  reactionRelayTargets,
  reactionSpaceId,
} from "../reactionToggle";

const ME = "a".repeat(64);
const AUTHOR = "b".repeat(64);
const HOST = "wss://host.example";
const MIRROR = "wss://mirror.example";
const SPACE = { id: "space-1", mode: "read-write" as const, hostRelay: HOST, relayUrls: [MIRROR] };
const chatTarget = { eventId: "msg1", pubkey: AUTHOR, kind: 9 };
const noteTarget = { eventId: "note1", pubkey: AUTHOR, kind: 1 };

function published(): UnsignedEvent[] {
  return mockSignAndPublish.mock.calls.map((c) => c[0] as UnsignedEvent);
}
function targetsOf(callIndex: number): string[] | undefined {
  return mockSignAndPublish.mock.calls[callIndex][1] as string[] | undefined;
}

// Spy (not module-mock) so the rest of the relayManager surface stays intact for
// modules that wire themselves up at import time.
const mockConnect = vi.spyOn(relayManager, "connect").mockImplementation(() => undefined as never);

beforeEach(() => {
  store.dispatch(resetAll());
  mockSignAndPublish.mockReset();
  mockConnect.mockClear();
  // Behave like the real thing: the signed event is returned; the local pipeline
  // pass is what normally folds it into the store, which these tests stub out.
  mockSignAndPublish.mockImplementation(async (u: UnsignedEvent) => ({ ...u, id: "signed", sig: "" }));
});

describe("reactionRelayTargets / reactionSpaceId", () => {
  it("chat reactions carry the space id and go to the space relay set", () => {
    expect(reactionSpaceId(chatTarget, SPACE)).toBe("space-1");
    expect(reactionRelayTargets(chatTarget, SPACE)).toEqual([HOST, MIRROR]);
  });

  it("note reactions follow the useNoteActions rule: host relay in read-write spaces", () => {
    expect(reactionSpaceId(noteTarget, SPACE)).toBeUndefined();
    expect(reactionRelayTargets(noteTarget, SPACE)).toEqual([HOST]);
  });

  it("read-only / no-space contexts broadcast to the user's write relays", () => {
    expect(reactionRelayTargets(noteTarget, { ...SPACE, mode: "read" })).toBeUndefined();
    expect(reactionRelayTargets(noteTarget, null)).toBeUndefined();
    expect(reactionRelayTargets(chatTarget, undefined)).toBeUndefined();
  });
});

describe("toggleReaction (chat)", () => {
  it("publishes an h-tagged kind:7 to the host relay set when not yet reacted", async () => {
    const result = await toggleReaction({ myPubkey: ME, target: chatTarget, content: "👍", space: SPACE });
    expect(result).toBe("added");
    expect(published()).toHaveLength(1);
    const ev = published()[0];
    expect(ev.kind).toBe(7);
    expect(ev.content).toBe("👍");
    expect(ev.tags).toEqual([
      ["e", "msg1"],
      ["p", AUTHOR],
      ["k", "9"],
      ["h", "space-1"],
    ]);
    expect(targetsOf(0)).toEqual([HOST, MIRROR]);
    // Every target is dialed before publishing (relayManager.publish drops unknown urls).
    expect(mockConnect).toHaveBeenCalledWith(HOST, "read+write");
    expect(mockConnect).toHaveBeenCalledWith(MIRROR, "read+write");
  });

  it("same emoji again publishes an h-tagged kind:5 for the reaction id — never a duplicate kind:7", async () => {
    store.dispatch(addReaction({ targetEventId: "msg1", reactor: ME, content: "👍", eventId: "rx1" }));
    const result = await toggleReaction({ myPubkey: ME, target: chatTarget, content: "👍", space: SPACE });
    expect(result).toBe("removed");
    expect(published()).toHaveLength(1);
    const ev = published()[0];
    expect(ev.kind).toBe(5);
    expect(ev.content).toBe("");
    expect(ev.tags).toEqual([["e", "rx1"], ["k", "7"], ["h", "space-1"]]);
    expect(ev.tags.some((t) => t[0] === "e" && t[1] === "msg1")).toBe(false);
    expect(targetsOf(0)).toEqual([HOST, MIRROR]);
    // Optimistically gone from the store.
    expect(selectReactionCount(store.getState(), "msg1")).toBe(0);
  });

  it("a different emoji adds alongside the existing one (multi-emoji per user)", async () => {
    store.dispatch(addReaction({ targetEventId: "msg1", reactor: ME, content: "👍", eventId: "rx1" }));
    const result = await toggleReaction({ myPubkey: ME, target: chatTarget, content: "🔥", space: SPACE });
    expect(result).toBe("added");
    expect(published()[0].kind).toBe(7);
    expect(selectReactionCount(store.getState(), "msg1")).toBe(1); // rx1 untouched
  });

  it("treats empty content as + on both sides of the toggle", async () => {
    store.dispatch(addReaction({ targetEventId: "msg1", reactor: ME, content: "", eventId: "rx1" }));
    await toggleReaction({ myPubkey: ME, target: chatTarget, content: "", space: SPACE });
    expect(published()[0].kind).toBe(5);
  });

  it("does not retract another user's reaction with the same emoji", async () => {
    store.dispatch(addReaction({ targetEventId: "msg1", reactor: AUTHOR, content: "👍", eventId: "rx-theirs" }));
    const result = await toggleReaction({ myPubkey: ME, target: chatTarget, content: "👍", space: SPACE });
    expect(result).toBe("added");
    expect(published()[0].kind).toBe(7);
    expect(selectReactionCount(store.getState(), "msg1")).toBe(1);
  });

  it("rolls the optimistic removal back when publishing the kind:5 fails", async () => {
    store.dispatch(addReaction({ targetEventId: "msg1", reactor: ME, content: "👍", eventId: "rx1" }));
    mockSignAndPublish.mockRejectedValueOnce(new Error("signer timeout"));
    await expect(
      toggleReaction({ myPubkey: ME, target: chatTarget, content: "👍", space: SPACE }),
    ).rejects.toThrow("signer timeout");
    expect(selectMyReaction(store.getState(), "msg1", ME)).toBe("👍");
    expect(store.getState().reactions.byEventId["rx1"]).toBe("msg1");
  });
});

describe("toggleLike (notes)", () => {
  it("likes with a + kind:7 (no h tag) targeting the host relay in a read-write space", async () => {
    await toggleLike({ myPubkey: ME, target: noteTarget, space: SPACE });
    const ev = published()[0];
    expect(ev.kind).toBe(7);
    expect(ev.content).toBe("+");
    expect(ev.tags).toEqual([["e", "note1"], ["p", AUTHOR], ["k", "1"]]);
    expect(targetsOf(0)).toEqual([HOST]);
  });

  it("unlikes by retracting the existing reaction instead of stacking another kind:7", async () => {
    store.dispatch(addReaction({ targetEventId: "note1", reactor: ME, content: "+", eventId: "rx1" }));
    const result = await toggleLike({ myPubkey: ME, target: noteTarget, space: null });
    expect(result).toBe("removed");
    expect(published()).toHaveLength(1);
    expect(published()[0].kind).toBe(5);
    expect(published()[0].tags).toEqual([["e", "rx1"], ["k", "7"]]);
    expect(targetsOf(0)).toBeUndefined();
  });

  it("retracts every own reaction on the note (legacy duplicate likes), one kind:5 each", async () => {
    store.dispatch(addReaction({ targetEventId: "note1", reactor: ME, content: "+", eventId: "rx1" }));
    store.dispatch(addReaction({ targetEventId: "note1", reactor: ME, content: "+", eventId: "rx2" }));
    store.dispatch(addReaction({ targetEventId: "note1", reactor: AUTHOR, content: "+", eventId: "rx3" }));
    await toggleLike({ myPubkey: ME, target: noteTarget });
    const kind5s = published().filter((e) => e.kind === 5);
    expect(kind5s).toHaveLength(2);
    expect(kind5s.map((e) => e.tags[0][1]).sort()).toEqual(["rx1", "rx2"]);
    // The other user's reaction is untouched.
    expect(selectReactionCount(store.getState(), "note1")).toBe(1);
  });
});
