import { describe, it, expect } from "vitest";
import type { NostrEvent } from "@thewired/shared-types";
import {
  ANCESTORS_EXPANDED_KEY,
  buildThreadTree,
  compareEventsChrono,
  directParentId,
  flattenThread,
  isDirectReply,
  isQuoteOnly,
  parseQuoteRef,
  parseThreadRef,
} from "../thread";

function evt(
  id: string,
  tags: string[][] = [],
  created_at = 1000,
  kind = 1,
): NostrEvent {
  return { id, pubkey: `pk-${id}`, created_at, kind, tags, content: id, sig: "sig" };
}

const reply = (id: string, rootId: string, parentId: string, at: number): NostrEvent =>
  evt(
    id,
    rootId === parentId
      ? [["e", rootId, "", "root"]]
      : [
          ["e", rootId, "", "root"],
          ["e", parentId, "", "reply"],
        ],
    at,
  );

describe("parseThreadRef", () => {
  it("reads marked root + reply tags", () => {
    const e = evt("a", [
      ["e", "root1", "", "root"],
      ["e", "parent1", "", "reply"],
    ]);
    expect(parseThreadRef(e)).toEqual({ rootId: "root1", replyId: "parent1" });
  });

  it("falls back across markers when only one is present", () => {
    const e = evt("a", [["e", "root1", "", "root"]]);
    expect(parseThreadRef(e)).toEqual({ rootId: "root1", replyId: "root1" });
  });

  it("positional: single unmarked e-tag is both root and reply", () => {
    const e = evt("a", [["e", "root1"]]);
    expect(parseThreadRef(e)).toEqual({ rootId: "root1", replyId: "root1" });
  });

  it("a lone mention-marked e-tag is NOT a thread reference (quote post)", () => {
    const e = evt("a", [["e", "quoted1", "", "mention"]]);
    expect(parseThreadRef(e)).toEqual({ rootId: null, replyId: null });
  });

  it("positional: first is root, last is reply", () => {
    const e = evt("a", [
      ["e", "root1"],
      ["e", "mid1"],
      ["e", "parent1"],
    ]);
    expect(parseThreadRef(e)).toEqual({ rootId: "root1", replyId: "parent1" });
  });

  it("positional path skips mention-marked tags", () => {
    const e = evt("a", [
      ["e", "root1"],
      ["e", "quoted1", "", "mention"],
      ["e", "parent1"],
    ]);
    expect(parseThreadRef(e)).toEqual({ rootId: "root1", replyId: "parent1" });
  });

  it("all-mention tags parse as no reference", () => {
    const e = evt("a", [
      ["e", "q1", "", "mention"],
      ["e", "q2", "", "mention"],
    ]);
    expect(parseThreadRef(e)).toEqual({ rootId: null, replyId: null });
  });

  it("no e-tags parse as no reference", () => {
    expect(parseThreadRef(evt("a"))).toEqual({ rootId: null, replyId: null });
  });
});

describe("quote classification", () => {
  it("parseQuoteRef reads the first q tag", () => {
    const e = evt("a", [["q", "quoted1", "wss://r.example", "pk1"]]);
    expect(parseQuoteRef(e)).toEqual({
      eventId: "quoted1",
      relayHint: "wss://r.example",
      pubkey: "pk1",
    });
    expect(parseQuoteRef(evt("b"))).toBeNull();
  });

  it("isQuoteOnly: q-tag-only and mention-only posts are quotes", () => {
    expect(isQuoteOnly(evt("a", [["q", "quoted1"]]))).toBe(true);
    expect(isQuoteOnly(evt("b", [["e", "quoted1", "", "mention"]]))).toBe(true);
  });

  it("isQuoteOnly: replies are not quotes, even with a q tag", () => {
    expect(isQuoteOnly(evt("a", [["e", "root1", "", "root"]]))).toBe(false);
    expect(
      isQuoteOnly(
        evt("b", [
          ["e", "root1", "", "root"],
          ["q", "quoted1"],
        ]),
      ),
    ).toBe(false);
  });

  it("isQuoteOnly: plain notes are not quotes", () => {
    expect(isQuoteOnly(evt("a"))).toBe(false);
  });
});

describe("directParentId / isDirectReply / compareEventsChrono", () => {
  it("prefers the reply marker as the immediate parent", () => {
    const e = reply("a", "root1", "parent1", 1);
    expect(directParentId(e)).toBe("parent1");
    expect(isDirectReply(e, "parent1")).toBe(true);
    expect(isDirectReply(e, "root1")).toBe(false);
  });

  it("compareEventsChrono sorts by created_at with id tiebreak", () => {
    const list = [evt("b", [], 5), evt("a", [], 5), evt("c", [], 1)];
    expect(list.sort(compareEventsChrono).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

describe("buildThreadTree", () => {
  const root = evt("root", [], 100);

  it("builds a linear chain with descendant counts and ancestors", () => {
    const a = reply("a", "root", "root", 110);
    const b = reply("b", "root", "a", 120);
    const tree = buildThreadTree([root, a, b], { rootId: "root", focusId: "b" });

    expect(tree.root?.event.id).toBe("root");
    expect(tree.root?.descendants).toBe(2);
    expect(tree.root?.children.map((c) => c.event.id)).toEqual(["a"]);
    expect(tree.root?.children[0]?.children.map((c) => c.event.id)).toEqual(["b"]);
    expect(tree.focus?.event.id).toBe("b");
    expect(tree.ancestors.map((e) => e.id)).toEqual(["root", "a"]);
    expect(tree.ancestorsComplete).toBe(true);
  });

  it("orders siblings chronologically with id tiebreak", () => {
    const late = reply("late", "root", "root", 130);
    const early = reply("early", "root", "root", 105);
    const tree = buildThreadTree([root, late, early], { rootId: "root", focusId: "root" });
    expect(tree.focus?.children.map((c) => c.event.id)).toEqual(["early", "late"]);
  });

  it("re-parents replies with missing parents under the root as orphans", () => {
    const stray = reply("stray", "root", "missing", 140);
    const tree = buildThreadTree([root, stray], { rootId: "root", focusId: "root" });
    const orphan = tree.root?.children.find((c) => c.event.id === "stray");
    expect(orphan?.orphan).toBe(true);
  });

  it("excludes events whose refs point outside this conversation", () => {
    // e-mentions our root but genuinely replies in another thread.
    const external = evt("ext", [
      ["e", "other-root", "", "root"],
      ["e", "other-parent", "", "reply"],
      ["e", "root", "", "mention"],
    ]);
    const tree = buildThreadTree([root, external], { rootId: "root", focusId: "root" });
    expect(tree.root?.children).toEqual([]);
  });

  it("excludes quote-only events from the tree", () => {
    const quote = evt("quote", [["e", "root", "", "mention"]], 150);
    const qQuote = evt("qquote", [["q", "root"]], 151);
    const tree = buildThreadTree([root, quote, qQuote], { rootId: "root", focusId: "root" });
    expect(tree.root?.children).toEqual([]);
  });

  it("terminates on parent cycles and keeps each event once", () => {
    const x = evt(
      "x",
      [
        ["e", "root", "", "root"],
        ["e", "y", "", "reply"],
      ],
      160,
    );
    const y = evt(
      "y",
      [
        ["e", "root", "", "root"],
        ["e", "x", "", "reply"],
      ],
      170,
    );
    const tree = buildThreadTree([root, x, y], { rootId: "root", focusId: "root" });
    const ids: string[] = [];
    const walk = (n: NonNullable<typeof tree.root>): void => {
      ids.push(n.event.id);
      n.children.forEach(walk);
    };
    walk(tree.root!);
    expect(ids.sort()).toEqual(["root", "x", "y"]);
  });

  it("builds the focus subtree even when the root event is missing", () => {
    const a = reply("a", "root", "root", 110);
    const b = reply("b", "root", "a", 120);
    const tree = buildThreadTree([a, b], { rootId: "root", focusId: "a" });
    expect(tree.root).toBeNull();
    expect(tree.focus?.event.id).toBe("a");
    expect(tree.focus?.children.map((c) => c.event.id)).toEqual(["b"]);
    expect(tree.ancestorsComplete).toBe(false);
    expect(tree.ancestors).toEqual([]);
  });
});

describe("flattenThread", () => {
  const root = evt("root", [], 100);

  it("returns no rows when the focus event is missing", () => {
    const tree = buildThreadTree([], { rootId: "root", focusId: "root" });
    expect(flattenThread(tree, { expanded: new Set() })).toEqual([]);
  });

  it("clamps reply depth and collapses deeper branches behind expanders", () => {
    const a = reply("a", "root", "root", 110);
    const b = reply("b", "root", "a", 120);
    const c = reply("c", "root", "b", 130);
    const d = reply("d", "root", "c", 140);
    const tree = buildThreadTree([root, a, b, c, d], { rootId: "root", focusId: "root" });

    const collapsed = flattenThread(tree, { expanded: new Set() });
    expect(collapsed.map((r) => r.key)).toEqual(["root", "a", "b", "x:b"]);
    const expander = collapsed[3];
    expect(expander).toMatchObject({ kind: "expander", parentId: "b", hiddenCount: 2 });

    const expandedRows = flattenThread(tree, { expanded: new Set(["b"]) });
    expect(expandedRows.map((r) => r.key)).toEqual(["root", "a", "b", "c", "x:c"]);
    // c renders at the clamped indent and gates its own subtree.
    expect(expandedRows[3]).toMatchObject({ kind: "reply", depth: 2 });
  });

  it("bounds the ancestor block and expands it in place", () => {
    const a = reply("a", "root", "root", 110);
    const b = reply("b", "root", "a", 120);
    const c = reply("c", "root", "b", 130);
    const focus = reply("f", "root", "c", 140);
    const tree = buildThreadTree([root, a, b, c, focus], { rootId: "root", focusId: "f" });

    const collapsed = flattenThread(tree, { expanded: new Set() });
    expect(collapsed.map((r) => r.kind)).toEqual([
      "ancestor",
      "ancestor-gap",
      "ancestor",
      "focus",
    ]);
    expect(collapsed[0]).toMatchObject({ key: "root", isRoot: true });
    expect(collapsed[1]).toMatchObject({ hiddenCount: 2, unknownDepth: false });
    expect(collapsed[2]).toMatchObject({ key: "c" });

    const expanded = flattenThread(tree, { expanded: new Set([ANCESTORS_EXPANDED_KEY]) });
    expect(expanded.map((r) => r.key)).toEqual(["root", "a", "b", "c", "f"]);
  });

  it("flags an unknown gap when the chain doesn't reach the root", () => {
    // Parent exists but grandparent (and root) were never fetched.
    const parent = reply("p", "root", "missing", 120);
    const focus = reply("f", "root", "p", 130);
    const tree = buildThreadTree([parent, focus], { rootId: "root", focusId: "f" });

    const rows = flattenThread(tree, { expanded: new Set() });
    expect(rows.map((r) => r.kind)).toEqual(["ancestor-gap", "ancestor", "focus"]);
    expect(rows[0]).toMatchObject({ unknownDepth: true });
    expect(rows[1]).toMatchObject({ key: "p", isRoot: false });
  });

  it("emits a load-older row after the focus when truncated", () => {
    const a = reply("a", "root", "root", 110);
    const tree = buildThreadTree([root, a], { rootId: "root", focusId: "root" });
    const rows = flattenThread(tree, { expanded: new Set(), truncated: true });
    expect(rows.map((r) => r.kind)).toEqual(["focus", "load-older", "reply"]);
  });

  it("keeps row keys unique and stable across recomputes", () => {
    const a = reply("a", "root", "root", 110);
    const b = reply("b", "root", "a", 120);
    const c = reply("c", "root", "b", 130);
    const tree = buildThreadTree([root, a, b, c], { rootId: "root", focusId: "root" });
    const rows1 = flattenThread(tree, { expanded: new Set(), truncated: true });
    const rows2 = flattenThread(tree, { expanded: new Set(), truncated: true });
    expect(rows1.map((r) => r.key)).toEqual(rows2.map((r) => r.key));
    expect(new Set(rows1.map((r) => r.key)).size).toBe(rows1.length);
  });
});
