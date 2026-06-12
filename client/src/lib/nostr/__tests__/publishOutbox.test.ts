import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NostrEvent } from "@/types/nostr";

const h = vi.hoisted(() => ({
  putOutbox: vi.fn().mockResolvedValue(undefined),
  deleteOutbox: vi.fn().mockResolvedValue(undefined),
  getAllOutbox: vi.fn(),
  publish: vi.fn(),
  eventsState: { ids: [] as string[], entities: {} as Record<string, NostrEvent> },
}));
vi.mock("@/lib/db/outboxStore", () => ({
  putOutbox: h.putOutbox,
  deleteOutbox: h.deleteOutbox,
  getAllOutbox: h.getAllOutbox,
}));
vi.mock("@/lib/nostr/relayManager", () => ({ relayManager: { publish: h.publish } }));
vi.mock("@/store", () => ({ store: { getState: () => ({ events: h.eventsState }) } }));

const { putOutbox, deleteOutbox, getAllOutbox, publish } = h;
let outboxRows: Array<{ id: string; event: NostrEvent; targetRelays?: string[]; queuedAt: number }> = [];

import { publishOutbox } from "../publishOutbox";

function ev(over: Partial<NostrEvent> = {}): NostrEvent {
  return { id: "id1", pubkey: "pk", created_at: 1000, kind: 1, tags: [], content: "", sig: "s", ...over };
}

beforeEach(() => {
  putOutbox.mockClear();
  deleteOutbox.mockClear();
  publish.mockClear();
  getAllOutbox.mockClear().mockImplementation(async () => outboxRows);
  outboxRows = [];
  h.eventsState = { ids: [], entities: {} };
});

describe("publishOutbox", () => {
  it("record() queues the event; the first SUCCESS OK deletes the row", () => {
    const e = ev({ id: "abc" });
    publishOutbox.record(e);
    expect(putOutbox).toHaveBeenCalledWith(e, undefined, expect.any(Number));

    publishOutbox.handleOK("abc", false); // a rejection must NOT clear the row
    expect(deleteOutbox).not.toHaveBeenCalled();

    publishOutbox.handleOK("abc", true); // first success clears it
    expect(deleteOutbox).toHaveBeenCalledWith("abc");
  });

  it("handleOK ignores ids it isn't tracking", () => {
    publishOutbox.handleOK("never-recorded", true);
    expect(deleteOutbox).not.toHaveBeenCalled();
  });

  it("replay re-publishes a fresh, non-replaceable row", async () => {
    outboxRows = [{ id: "x", event: ev({ id: "x" }), queuedAt: 1_000_000 }];
    await publishOutbox.replay(1_000_000 + 1000);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("replay drops rows older than 24h instead of re-publishing", async () => {
    outboxRows = [{ id: "old", event: ev({ id: "old" }), queuedAt: 0 }];
    await publishOutbox.replay(25 * 60 * 60 * 1000);
    expect(publish).not.toHaveBeenCalled();
    expect(deleteOutbox).toHaveBeenCalledWith("old");
  });

  it("replay SKIPS a stale replaceable when the store holds a newer version", async () => {
    const stale = ev({ id: "p-old", kind: 0, pubkey: "ME", created_at: 100 });
    const newer = ev({ id: "p-new", kind: 0, pubkey: "ME", created_at: 200 });
    h.eventsState = { ids: ["p-new"], entities: { "p-new": newer } };
    outboxRows = [{ id: "p-old", event: stale, queuedAt: 1_000_000 }];

    await publishOutbox.replay(1_000_000 + 1000);

    expect(publish).not.toHaveBeenCalled(); // would clobber the newer kind:0
    expect(deleteOutbox).toHaveBeenCalledWith("p-old");
  });

  it("replay re-publishes a replaceable that is still the newest", async () => {
    const e = ev({ id: "p1", kind: 0, pubkey: "ME", created_at: 500 });
    outboxRows = [{ id: "p1", event: e, queuedAt: 1_000_000 }];
    await publishOutbox.replay(1_000_000 + 1000);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("guards against overlapping replays", async () => {
    let resolveGet: (v: typeof outboxRows) => void = () => {};
    getAllOutbox.mockImplementationOnce(() => new Promise((r) => { resolveGet = r; }));
    const p1 = publishOutbox.replay();
    const p2 = publishOutbox.replay(); // replaying === true → early return
    resolveGet([]);
    await Promise.all([p1, p2]);
    expect(getAllOutbox).toHaveBeenCalledTimes(1);
  });
});
