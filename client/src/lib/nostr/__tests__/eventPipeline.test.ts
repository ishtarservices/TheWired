import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  processIncomingEvent,
  flushEventPipeline,
  resetEventPipelineCaches,
  computeSweep,
  __sweepForTest,
} from "../eventPipeline";
import { store, resetAll } from "@/store";
import { eventsSelectors, eventsSlice } from "@/store/slices/eventsSlice";
import { EventDeduplicator } from "../dedup";
import type { NostrEvent } from "@/types/nostr";

// verifyBridge.verify is globally mocked to resolve true (vitest.setup.ts),
// IndexedDB is faked, and Worker is stubbed — so the real pipeline + store run
// headless. These tests exercise the burst-batching seam added in Phase 1.

const WS = "wss://relay.example";
const SIG = "0".repeat(128);
const hex64 = (n: number) => n.toString(16).padStart(64, "0");

function makeEvent(id: number, over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: hex64(id),
    pubkey: hex64(1_000_000 + id),
    // Derive from the (faked) clock so the "future event" guard never trips.
    created_at: Math.floor(Date.now() / 1000) - 60,
    kind: 1,
    tags: [],
    content: "hi",
    sig: SIG,
    ...over,
  };
}

function reaction(id: number, target: string): NostrEvent {
  return makeEvent(id, { kind: 7, tags: [["e", target]], content: "+" });
}

beforeEach(() => {
  vi.useFakeTimers();
  store.dispatch(resetAll());
  resetEventPipelineCaches();
});

afterEach(() => {
  resetEventPipelineCaches();
  vi.useRealTimers();
});

describe("eventPipeline — burst batching", () => {
  it("buffers burst-path events until the flush timer fires", async () => {
    const target = hex64(0xaaa);
    for (let i = 1; i <= 30; i++) {
      await processIncomingEvent(reaction(i, target), WS);
    }
    // Pending — nothing applied yet (timer not fired)
    expect(store.getState().reactions.byTarget[target]).toBeUndefined();
    vi.advanceTimersByTime(50);
    // 30 distinct reactors folded into the aggregate
    expect(Object.keys(store.getState().reactions.byTarget[target])).toHaveLength(30);
  });

  it("coalesces a burst into a single addEvents dispatch", async () => {
    const target = hex64(0xbbb);
    const spy = vi.spyOn(store, "dispatch");
    for (let i = 1; i <= 10; i++) {
      await processIncomingEvent(reaction(i, target), WS);
    }
    const before = spy.mock.calls.length;
    vi.advanceTimersByTime(50);
    const flushed = spy.mock.calls.slice(before);
    const addReactionsCalls = flushed.filter(
      (c) => (c[0] as { type?: string })?.type === "reactions/addReactions",
    );
    spy.mockRestore();
    // 10 reactions → exactly one batched addReactions carrying all 10
    expect(addReactionsCalls).toHaveLength(1);
    expect(
      (addReactionsCalls[0][0] as unknown as { payload: unknown[] }).payload,
    ).toHaveLength(10);
  });

  it("events spaced beyond the window flush separately", async () => {
    const target = hex64(0xccc);
    await processIncomingEvent(reaction(1, target), WS);
    vi.advanceTimersByTime(50);
    expect(Object.keys(store.getState().reactions.byTarget[target])).toHaveLength(1);
    await processIncomingEvent(reaction(2, target), WS);
    vi.advanceTimersByTime(50);
    expect(Object.keys(store.getState().reactions.byTarget[target])).toHaveLength(2);
  });

  it("applies synthetic-source events synchronously (optimistic sends)", async () => {
    const ev = makeEvent(7);
    await processIncomingEvent(ev, "local");
    // No timer advance — applied during the await so optimistic UI stays instant
    expect(
      eventsSelectors.selectById(store.getState().events, ev.id),
    ).toBeDefined();
  });

  it("flushes immediately when the buffer hits its hard cap", async () => {
    for (let i = 1; i <= 256; i++) {
      await processIncomingEvent(makeEvent(i), WS);
    }
    // Cap (256) reached on the last event → flushed without advancing timers
    expect(eventsSelectors.selectTotal(store.getState().events)).toBe(256);
  });

  it("dispatches entities before their index entries (no transient under-count)", async () => {
    const spy = vi.spyOn(store, "dispatch");
    await processIncomingEvent(makeEvent(1), WS); // a note → addEvent + indexNote
    vi.advanceTimersByTime(50);
    const types = spy.mock.calls.map((c) => (c[0] as { type?: string })?.type);
    spy.mockRestore();
    const addIdx = types.indexOf("events/addEvents");
    const noteIdx = types.indexOf("events/indexNotes");
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(noteIdx).toBeGreaterThan(addIdx);
  });

  it("reactions fold into the aggregate and are NOT stored as full events", async () => {
    const target = hex64(0xeee);
    await processIncomingEvent(reaction(1, target), WS);
    flushEventPipeline();
    // The kind:7 event itself never enters the entity adapter…
    expect(
      eventsSelectors.selectById(store.getState().events, hex64(1)),
    ).toBeUndefined();
    // …it lives in the reaction aggregate instead.
    expect(store.getState().reactions.byTarget[target]).toBeDefined();
  });

  it("a deletion flushes the buffer first, then removes a same-burst target", async () => {
    const note = makeEvent(42);
    await processIncomingEvent(note, WS); // buffered, not yet applied
    const del = makeEvent(43, {
      kind: 5,
      pubkey: note.pubkey, // same author — deletions only apply to own events
      tags: [["e", note.id]],
      content: "",
    });
    await processIncomingEvent(del, WS);
    // The deletion force-flushed the pending add, saw the target, then removed it
    expect(
      eventsSelectors.selectById(store.getState().events, note.id),
    ).toBeUndefined();
    expect(store.getState().events.deletedNoteIds[note.id]).toBe(true);
  });

  it("flushEventPipeline is a no-op on an empty buffer", () => {
    const spy = vi.spyOn(store, "dispatch");
    flushEventPipeline();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// B2 — entity-store mark-and-sweep. computeSweep is pure; __sweepForTest wires it
// to the real store + dedup with explicit caps so we needn't seed 20k events.
describe("eventPipeline — entity sweep (B2)", () => {
  it("computeSweep returns [] at/under the soft cap", () => {
    expect(computeSweep(["a", "b", "c"], [], {}, 5, 3)).toEqual([]);
  });

  it("computeSweep evicts the oldest UNREFERENCED ids down to target, protecting referenced", () => {
    const ids = ["a", "b", "c", "d", "e", "f"]; // oldest-first (created_at asc)
    const indices = [{ room: ["a"] }]; // 'a' referenced (e.g. chat) → protected
    const edited = { x: "b" }; // 'b' referenced via editedMessages → protected
    // len 6 > softCap 4 → need = 6 - target(2) = 4; skip a,b → evict c,d,e,f
    expect(computeSweep(ids, indices, edited, 4, 2)).toEqual(["c", "d", "e", "f"]);
  });

  it("computeSweep stops at `need` even when more unreferenced remain", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    // softCap 4, target 4 → need = 2; nothing referenced → evict the 2 oldest
    expect(computeSweep(ids, [], {}, 4, 4)).toEqual(["a", "b"]);
  });

  it("sweep evicts oldest unreferenced, KEEPS chat-referenced ids, and unmarks evicted from dedup", () => {
    const { addEvents, indexChatMessage } = eventsSlice.actions;
    const events: NostrEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent(i, { id: `e${i}`, created_at: 1000 + i })); // e0 oldest
    }
    store.dispatch(addEvents(events));
    // Protect the two oldest by referencing them from the (uncapped) chat index.
    store.dispatch(indexChatMessage({ groupId: "room", eventId: "e0" }));
    store.dispatch(indexChatMessage({ groupId: "room", eventId: "e1" }));

    const unmark = vi.spyOn(EventDeduplicator.prototype, "unmarkSeen");

    // 10 ids > softCap 5 → need = 10 - target(3) = 7; skip e0,e1 → evict e2..e8.
    __sweepForTest(5, 3);

    const sel = (id: string) => eventsSelectors.selectById(store.getState().events, id);
    // Chat-referenced survive (no recovery path → must never be evicted).
    expect(sel("e0")).toBeDefined();
    expect(sel("e1")).toBeDefined();
    // Oldest unreferenced evicted.
    for (let i = 2; i <= 8; i++) expect(sel(`e${i}`)).toBeUndefined();
    // Newest one left untouched once target reached.
    expect(sel("e9")).toBeDefined();

    // CRITICAL: every evicted id was unmarked from the dedup LRU so a re-REQ can
    // bring it back (else it's silently swallowed as a duplicate).
    const unmarked = unmark.mock.calls.map((c) => c[0]);
    for (let i = 2; i <= 8; i++) expect(unmarked).toContain(`e${i}`);
    unmark.mockRestore();
  });
});
