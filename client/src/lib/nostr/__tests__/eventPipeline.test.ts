import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  processIncomingEvent,
  flushEventPipeline,
  resetEventPipelineCaches,
} from "../eventPipeline";
import { store, resetAll } from "@/store";
import { eventsSelectors } from "@/store/slices/eventsSlice";
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
