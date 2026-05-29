import { describe, it, expect } from "vitest";
import type { RootState } from "@/store";
import type { NostrEvent } from "@/types/nostr";
import { selectSpaceNotes, selectSpaceRootNotes } from "../spaceSelectors";

function note(id: string, created_at: number, tags: string[][] = []): NostrEvent {
  return { id, pubkey: "pk", created_at, kind: 1, tags, content: "", sig: "sig" };
}

function makeState(
  entities: Record<string, NostrEvent>,
  spaceFeeds: Record<string, string[]>,
  activeSpaceId: string | null = "space1",
): RootState {
  return {
    spaces: { activeSpaceId },
    events: { spaceFeeds, entities },
  } as unknown as RootState;
}

describe("spaceSelectors — stable references", () => {
  it("keeps the same array reference when an unrelated event is added", () => {
    const a = note("a", 2);
    const b = note("b", 1);
    const feeds = { "space1:notes": ["a", "b"] };

    const r1 = selectSpaceNotes(makeState({ a, b }, feeds));
    expect(r1.map((n) => n.id)).toEqual(["a", "b"]); // sorted desc

    // A new event lands in the entity map but NOT in this feed.
    const r2 = selectSpaceNotes(makeState({ a, b, x: note("x", 99) }, feeds));
    expect(r2).toBe(r1); // same reference → the feed does not re-render
  });

  it("returns a new reference when the feed actually gains a note", () => {
    const a = note("a", 2);
    const b = note("b", 1);
    const c = note("c", 3);

    const r1 = selectSpaceNotes(makeState({ a, b }, { "space1:notes": ["a", "b"] }));
    const r2 = selectSpaceNotes(
      makeState({ a, b, c }, { "space1:notes": ["a", "b", "c"] }),
    );
    expect(r2).not.toBe(r1);
    expect(r2.map((n) => n.id)).toEqual(["c", "a", "b"]); // sorted desc
  });

  it("selectSpaceRootNotes excludes replies", () => {
    const root = note("root", 2);
    const reply = note("reply", 1, [["e", "root", "", "reply"]]);
    const r = selectSpaceRootNotes(
      makeState({ root, reply }, { "space1:notes": ["root", "reply"] }),
    );
    expect(r.map((n) => n.id)).toEqual(["root"]);
  });
});
