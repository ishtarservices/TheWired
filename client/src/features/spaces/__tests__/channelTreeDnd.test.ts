import { describe, it, expect } from "vitest";
import type { SpaceChannel, SpaceChannelCategory } from "../../../types/space";
import { buildChannelTree, moveChannel } from "../channelTree";
import { resolveChannelDrop } from "../ChannelTreeDnd";

const ch = (id: string, position: number, categoryId: string | null = null): SpaceChannel => ({
  id,
  spaceId: "s",
  type: "chat",
  label: `#${id}`,
  categoryId,
  position,
  isDefault: false,
  adminOnly: false,
  slowModeSeconds: 0,
  feedMode: "all",
});
const cat = (id: string, position: number): SpaceChannelCategory => ({ id, spaceId: "s", name: id, position });

// uncategorized: a b c ; T: x y
const tree = buildChannelTree([ch("a", 0), ch("b", 1), ch("c", 2), ch("x", 3, "T"), ch("y", 4, "T")], [cat("T", 0)]);

describe("resolveChannelDrop", () => {
  it("within a list, takes the hovered channel's slot (sortable semantics)", () => {
    expect(resolveChannelDrop(tree, "c", "ch:a", null)).toEqual({ categoryId: null, index: 0 });
    expect(resolveChannelDrop(tree, "a", "ch:c", null)).toEqual({ categoryId: null, index: 2 });
  });

  it("over itself or a subfolder zone keeps the current slot", () => {
    expect(resolveChannelDrop(tree, "b", "ch:b", null)).toEqual({ categoryId: null, index: 1 });
    expect(resolveChannelDrop(tree, "b", "zone:T", null)).toEqual({ categoryId: null, index: 1 });
  });

  it("right after crossing into a subfolder, keeps the inserted slot (no second move)", () => {
    // Dragged "a" over "y" (upper half) → inserted before y.
    const preview = moveChannel("a", "T", 1)(tree);
    expect(resolveChannelDrop(preview, "a", "ch:y", "ch:y")).toEqual({ categoryId: "T", index: 1 });
    // ...then moved on over "x" within T → takes x's slot.
    expect(resolveChannelDrop(preview, "a", "ch:x", "ch:y")).toEqual({ categoryId: "T", index: 0 });
  });

  it("returns null for a channel that isn't there", () => {
    expect(resolveChannelDrop(tree, "ghost", null, null)).toBeNull();
  });
});
