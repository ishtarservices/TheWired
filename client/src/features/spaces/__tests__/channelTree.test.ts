import { describe, it, expect } from "vitest";
import type { SpaceChannel, SpaceChannelCategory } from "../../../types/space";
import {
  buildChannelTree,
  flattenTree,
  treeToState,
  treeToLayoutDoc,
  validateCategoryName,
  deriveCategoryId,
  moveChannel,
  moveCategory,
  addCategory,
  renameCategory,
  removeCategory,
  addChannel,
  updateChannel,
  removeChannel,
  locateChannel,
  filterTree,
  visibleToFullIndex,
  TreeOpError,
} from "../channelTree";

const S = "space1";

function ch(id: string, position: number, categoryId?: string | null, extra: Partial<SpaceChannel> = {}): SpaceChannel {
  return {
    id,
    spaceId: S,
    type: "chat",
    label: `#${id}`,
    categoryId,
    position,
    isDefault: false,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
    ...extra,
  };
}

function cat(id: string, position: number, name = id): SpaceChannelCategory {
  return { id, spaceId: S, name, position };
}

const ids = (list: SpaceChannel[]) => list.map((c) => c.id);
const shape = (tree: ReturnType<typeof buildChannelTree>) => ({
  uncategorized: ids(tree.uncategorized),
  categories: tree.categories.map((n) => [n.category.id, n.category.name, ids(n.channels)]),
});

describe("buildChannelTree", () => {
  it("groups by category in canonical order: uncategorized first, categories by position", () => {
    const tree = buildChannelTree(
      [ch("b", 3, "voice"), ch("a", 0, null), ch("c", 2, "text"), ch("d", 1, "text"), ch("e", 4, undefined)],
      [cat("voice", 1, "Voice"), cat("text", 0, "Text")],
    );
    expect(shape(tree)).toEqual({
      uncategorized: ["a", "e"],
      categories: [["text", "Text", ["d", "c"]], ["voice", "Voice", ["b"]]],
    });
  });

  it("keeps empty categories", () => {
    const tree = buildChannelTree([ch("a", 0)], [cat("later", 0, "Later")]);
    expect(shape(tree).categories).toEqual([["later", "Later", []]]);
  });

  it("treats an empty-string categoryId as uncategorized", () => {
    expect(shape(buildChannelTree([ch("a", 0, "")], [])).uncategorized).toEqual(["a"]);
  });

  it("without a category list, derives categories from channel strings in first-appearance order (legacy grouping)", () => {
    const tree = buildChannelTree([ch("a", 0, "Dev"), ch("b", 1, null), ch("c", 2, "Ops"), ch("d", 3, "Dev")], undefined);
    expect(shape(tree)).toEqual({
      uncategorized: ["b"],
      categories: [["Dev", "Dev", ["a", "d"]], ["Ops", "Ops", ["c"]]],
    });
    expect(tree.categories.every((n) => n.synthetic)).toBe(true);
  });

  it("shows a channel whose category isn't in the list under a synthetic one, after the known ones", () => {
    const tree = buildChannelTree([ch("a", 0, "ghost"), ch("b", 1, "known")], [cat("known", 0)]);
    expect(shape(tree).categories).toEqual([["known", "known", ["b"]], ["ghost", "ghost", ["a"]]]);
    expect(tree.categories[1].synthetic).toBe(true);
  });

  it("breaks position ties by id so the order is stable", () => {
    expect(ids(buildChannelTree([ch("z", 0), ch("a", 0)], []).uncategorized)).toEqual(["a", "z"]);
  });
});

describe("treeToState / treeToLayoutDoc", () => {
  it("rewrites positions densely in canonical order and stamps categoryIds", () => {
    const tree = buildChannelTree([ch("a", 5, "t"), ch("b", 9, null)], [cat("t", 3)]);
    const { channels, categories } = treeToState(tree);
    expect(channels.map((c) => [c.id, c.categoryId, c.position])).toEqual([["b", null, 0], ["a", "t", 1]]);
    expect(categories.map((c) => [c.id, c.position])).toEqual([["t", 0]]);
  });

  it("omits ids for pending categories in the PUT body", () => {
    const tree = addCategory("New", "pending:1", S, true)(buildChannelTree([ch("a", 0)], [cat("t", 0, "T")]));
    expect(treeToLayoutDoc(tree, 7)).toEqual({
      baseRevision: 7,
      uncategorized: ["a"],
      categories: [{ id: "t", name: "T", channelIds: [] }, { name: "New", channelIds: [] }],
    });
  });
});

describe("tree operations", () => {
  const base = () =>
    buildChannelTree(
      [ch("a", 0), ch("b", 1), ch("c", 2, "t"), ch("d", 3, "t"), ch("e", 4, "v")],
      [cat("t", 0, "Text"), cat("v", 1, "Voice")],
    );

  it("moves a channel across categories at an index, and within one", () => {
    let tree = moveChannel("a", "t", 1)(base());
    expect(shape(tree).categories[0][2]).toEqual(["c", "a", "d"]);
    expect(shape(tree).uncategorized).toEqual(["b"]);
    tree = moveChannel("d", "t", 0)(tree);
    expect(shape(tree).categories[0][2]).toEqual(["d", "c", "a"]);
    tree = moveChannel("e", null, 0)(tree);
    expect(shape(tree).uncategorized).toEqual(["e", "b"]);
    expect(shape(tree).categories[1][2]).toEqual([]);
  });

  it("clamps out-of-range indices", () => {
    expect(shape(moveChannel("a", "v", 99)(base())).categories[1][2]).toEqual(["e", "a"]);
    expect(shape(moveChannel("e", "t", -5)(base())).categories[0][2]).toEqual(["e", "c", "d"]);
  });

  it("does not mutate its input", () => {
    const tree = base();
    const before = JSON.stringify(tree);
    moveChannel("a", "t", 0)(tree);
    moveCategory("v", 0)(tree);
    removeCategory("t")(tree);
    renameCategory("t", "Talk")(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("throws TreeOpError for ids that are gone (so a replayed op fails cleanly)", () => {
    expect(() => moveChannel("nope", null, 0)(base())).toThrow(TreeOpError);
    expect(() => moveChannel("a", "nope", 0)(base())).toThrow(TreeOpError);
    expect(() => moveCategory("nope", 0)(base())).toThrow(TreeOpError);
    expect(() => removeCategory("nope")(base())).toThrow(TreeOpError);
    expect(() => removeChannel("nope")(base())).toThrow(TreeOpError);
  });

  it("reorders categories", () => {
    expect(shape(moveCategory("v", 0)(base())).categories.map((c) => c[0])).toEqual(["v", "t"]);
  });

  it("adds, renames and removes categories (removed channels go to the end of uncategorized)", () => {
    let tree = addCategory("  Music  ", "m", S, false)(base());
    expect(shape(tree).categories.map((c) => c[1])).toEqual(["Text", "Voice", "Music"]);
    tree = renameCategory("t", "Talk")(tree);
    expect(shape(tree).categories[0][1]).toBe("Talk");
    tree = removeCategory("t")(tree);
    expect(shape(tree).uncategorized).toEqual(["a", "b", "c", "d"]);
  });

  it("refuses duplicate names ignoring case, but lets a category keep its own name", () => {
    expect(() => addCategory("text", "x", S, false)(base())).toThrow(/already/);
    expect(() => renameCategory("v", " TEXT ")(base())).toThrow(/already/);
    expect(shape(renameCategory("t", "TEXT")(base())).categories[0][1]).toBe("TEXT");
  });

  it("caps the number of categories", () => {
    let tree = buildChannelTree([], []);
    for (let i = 0; i < 50; i++) tree = addCategory(`c${i}`, `c${i}`, S, false)(tree);
    expect(() => addCategory("one more", "x", S, false)(tree)).toThrow(/at most 50/);
  });

  it("adds, updates and removes channels (relay-only spaces)", () => {
    let tree = addChannel(ch("n", 0), "v")(base());
    expect(shape(tree).categories[1][2]).toEqual(["e", "n"]);
    expect(() => addChannel(ch("n", 0), null)(tree)).toThrow(TreeOpError);
    tree = updateChannel("n", { label: "#renamed" })(tree);
    expect(flattenTree(tree).find((c) => c.id === "n")!.label).toBe("#renamed");
    tree = removeChannel("n")(tree);
    expect(flattenTree(tree).some((c) => c.id === "n")).toBe(false);
  });

  it("locates a channel", () => {
    expect(locateChannel(base(), "d")).toEqual({ categoryId: "t", index: 1 });
    expect(locateChannel(base(), "b")).toEqual({ categoryId: null, index: 1 });
    expect(locateChannel(base(), "zz")).toBeNull();
  });
});

describe("validateCategoryName", () => {
  const tree = buildChannelTree([], [cat("t", 0, "Text")]);
  it("trims, bounds and rejects control/invisible characters", () => {
    expect(validateCategoryName("   ", tree)).toMatch(/name/);
    expect(validateCategoryName("x".repeat(51), tree)).toMatch(/50/);
    for (const code of [0x0, 0x7, 0x200b, 0x202e, 0x2066, 0xfeff]) {
      expect(validateCategoryName(`a${String.fromCharCode(code)}b`, tree)).toMatch(/invisible/);
    }
    expect(validateCategoryName("  Fine  ", tree)).toBeNull();
    expect(validateCategoryName("Émoji 🎧 ok", tree)).toBeNull();
  });
});

describe("deriveCategoryId", () => {
  let n = 0;
  const random = () => `r${(n++).toString().padStart(11, "0")}`;
  it("matches the backend rule", () => {
    expect(deriveCategoryId("Dev", new Set(), random)).toBe("Dev");
    expect(deriveCategoryId("Dev", new Set(["Dev"]), random)).toBe("Dev~2");
    for (const unsafe of ["a/b", "..", ".", "50%", "q?x", "a#b", "y".repeat(65), " lead"]) {
      expect(deriveCategoryId(unsafe, new Set(), random)).toMatch(/^r\d{11}$/);
    }
  });
});

describe("filterTree / visibleToFullIndex", () => {
  // t: [c, h1, d, h2]; h* are hidden from the viewer.
  const full = buildChannelTree(
    [ch("c", 0, "t"), ch("h1", 1, "t"), ch("d", 2, "t"), ch("h2", 3, "t"), ch("x", 4)],
    [cat("t", 0)],
  );
  const visible = filterTree(full, (c) => !c.id.startsWith("h"));

  it("keeps categories while hiding channels", () => {
    expect(shape(visible).categories).toEqual([["t", "t", ["c", "d"]]]);
  });

  it("maps a visible drop slot to the full list, before the next visible channel", () => {
    // Drop x first in t (visible index 0) → before c.
    expect(visibleToFullIndex(full, visible, "x", "t", 0)).toBe(0);
    // Between c and d (visible index 1) → before d, i.e. after h1.
    expect(visibleToFullIndex(full, visible, "x", "t", 1)).toBe(2);
    // After d (visible end) → last, after h2.
    expect(visibleToFullIndex(full, visible, "x", "t", 2)).toBe(4);
    // Reordering within: move c after d → before nothing visible → end.
    expect(visibleToFullIndex(full, visible, "c", "t", 1)).toBe(3);
    const moved = moveChannel("x", "t", visibleToFullIndex(full, visible, "x", "t", 1))(full);
    expect(shape(moved).categories[0][2]).toEqual(["c", "h1", "x", "d", "h2"]);
  });
});
