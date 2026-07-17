import type { NostrEvent } from "@thewired/shared-types";

import { rankPeekReplies } from "../peekRank";

const evt = (id: string, createdAt: number): NostrEvent => ({
  id,
  pubkey: "p",
  created_at: createdAt,
  kind: 1,
  tags: [],
  content: id,
  sig: "s",
});

describe("rankPeekReplies", () => {
  it("orders by score descending", () => {
    const replies = [evt("a", 100), evt("b", 200), evt("c", 300)];
    const scores: Record<string, number> = { a: 1, b: 5, c: 2 };
    const ranked = rankPeekReplies(replies, (id) => scores[id] ?? 0);
    expect(ranked.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties chronologically ascending (the all-zeros default)", () => {
    const replies = [evt("late", 300), evt("early", 100), evt("mid", 200)];
    const ranked = rankPeekReplies(replies, () => 0);
    expect(ranked.map((e) => e.id)).toEqual(["early", "mid", "late"]);
  });

  it("does not mutate the input", () => {
    const replies = [evt("a", 100), evt("b", 200)];
    rankPeekReplies(replies, (id) => (id === "b" ? 1 : 0));
    expect(replies.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
