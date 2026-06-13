import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  processIncomingEvent,
  flushEventPipeline,
  resetEventPipelineCaches,
} from "../../../lib/nostr/eventPipeline";
import { store, resetAll } from "../../../store";
import { eventsSelectors } from "../../../store/slices/eventsSlice";
import type { NostrEvent } from "../../../types/nostr";

// Same headless setup as eventPipeline.test.ts: verifyBridge is mocked to
// resolve true, IndexedDB is faked, Worker is stubbed.

const WS = "wss://relay.example";
const SIG = "0".repeat(128);
const hex64 = (n: number) => n.toString(16).padStart(64, "0");

const AUTHOR = hex64(0xa07407);
const VOTER = hex64(0x707e6);

function pollEvent(over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: hex64(0x9011),
    pubkey: AUTHOR,
    created_at: Math.floor(Date.now() / 1000) - 60,
    kind: 1068,
    tags: [
      ["option", "opt1", "Yay"],
      ["option", "opt2", "Nay"],
      ["polltype", "singlechoice"],
      ["h", "space-x"],
      ["channel", "ch-1"],
    ],
    content: "Pineapple?",
    sig: SIG,
    ...over,
  };
}

function voteEvent(over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: hex64(0x107e),
    pubkey: VOTER,
    created_at: Math.floor(Date.now() / 1000) - 30,
    kind: 1018,
    tags: [
      ["e", hex64(0x9011)],
      ["response", "opt1"],
    ],
    content: "",
    sig: SIG,
    ...over,
  };
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

describe("poll pipeline indexing", () => {
  it("indexes an h+channel poll into the chat timeline", async () => {
    await processIncomingEvent(pollEvent(), WS);
    flushEventPipeline();

    const state = store.getState();
    expect(state.events.chatMessages["space-x:ch-1"]).toContain(hex64(0x9011));
    expect(eventsSelectors.selectById(state.events, hex64(0x9011))).toBeDefined();
  });

  it("folds votes into the polls aggregate WITHOUT storing the event", async () => {
    await processIncomingEvent(pollEvent(), WS);
    await processIncomingEvent(voteEvent(), WS);
    flushEventPipeline();

    const state = store.getState();
    expect(state.polls.byPoll[hex64(0x9011)][VOTER].optionIds).toEqual(["opt1"]);
    // The 1018 event must NOT land in the entity adapter (reaction-style aggregate)
    expect(eventsSelectors.selectById(state.events, hex64(0x107e))).toBeUndefined();
  });

  it("kind:5 from the voter removes their vote; from others it is a no-op", async () => {
    await processIncomingEvent(voteEvent(), WS);
    flushEventPipeline();
    expect(store.getState().polls.byPoll[hex64(0x9011)]).toBeDefined();

    // Deletion signed by someone else → vote stays
    await processIncomingEvent(
      {
        id: hex64(0xde1),
        pubkey: AUTHOR,
        created_at: Math.floor(Date.now() / 1000) - 10,
        kind: 5,
        tags: [["e", hex64(0x107e)]],
        content: "",
        sig: SIG,
      },
      WS,
    );
    expect(store.getState().polls.byPoll[hex64(0x9011)][VOTER]).toBeDefined();

    // Deletion signed by the voter → vote removed
    await processIncomingEvent(
      {
        id: hex64(0xde2),
        pubkey: VOTER,
        created_at: Math.floor(Date.now() / 1000) - 10,
        kind: 5,
        tags: [["e", hex64(0x107e)]],
        content: "",
        sig: SIG,
      },
      WS,
    );
    expect(store.getState().polls.byPoll[hex64(0x9011)]).toBeUndefined();
  });

  it("author deletion removes the poll from chat, entities, and the aggregate", async () => {
    await processIncomingEvent(pollEvent(), WS);
    await processIncomingEvent(voteEvent(), WS);
    flushEventPipeline();

    await processIncomingEvent(
      {
        id: hex64(0xde3),
        pubkey: AUTHOR,
        created_at: Math.floor(Date.now() / 1000) - 5,
        kind: 5,
        tags: [["e", hex64(0x9011)]],
        content: "",
        sig: SIG,
      },
      WS,
    );

    const state = store.getState();
    expect(state.events.chatMessages["space-x:ch-1"] ?? []).not.toContain(hex64(0x9011));
    expect(eventsSelectors.selectById(state.events, hex64(0x9011))).toBeUndefined();
    expect(state.polls.byPoll[hex64(0x9011)]).toBeUndefined();

    // Redelivery of the deleted poll is rejected
    await processIncomingEvent(pollEvent(), WS);
    flushEventPipeline();
    expect(eventsSelectors.selectById(store.getState().events, hex64(0x9011))).toBeUndefined();
  });

  it("indexes a bare poll (no h tag) into the author's notes", async () => {
    const bare = pollEvent({
      id: hex64(0x9012),
      tags: [
        ["option", "a", "A"],
        ["option", "b", "B"],
        ["polltype", "singlechoice"],
      ],
    });
    await processIncomingEvent(bare, WS);
    flushEventPipeline();

    expect(store.getState().events.notesByAuthor[AUTHOR]).toContain(hex64(0x9012));
  });
});
