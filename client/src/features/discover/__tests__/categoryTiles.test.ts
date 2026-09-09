import { describe, it, expect } from "vitest";
import { Boxes, Gamepad2 } from "lucide-react";
import type { SpaceCategory } from "@/lib/api/discover";
import { categoryIcon } from "../categoryIcons";
import { CATEGORY_TILE_CAP, categoryTiles, visibleCategories } from "../categoryTiles";

function cat(slug: string, spaceCount: number, position = 0): SpaceCategory {
  return { slug, name: slug, spaceCount, icon: null, description: null, position };
}

describe("visibleCategories", () => {
  it("hides categories with nothing behind them", () => {
    // A tile leading to an empty list reads as a broken app (same rule as
    // sceneChips), so a zero-count category never earns one.
    const out = visibleCategories([cat("music", 6), cat("social", 0), cat("art", 3)]);
    expect(out.map((c) => c.slug)).toEqual(["music", "art"]);
  });

  it("orders busiest first, then backend position, then slug", () => {
    const out = visibleCategories([
      cat("b", 2, 20),
      cat("a", 2, 20),
      cat("late", 2, 30),
      cat("big", 9, 99),
    ]);
    expect(out.map((c) => c.slug)).toEqual(["big", "a", "b", "late"]);
  });
});

describe("categoryTiles", () => {
  const eight = Array.from({ length: 8 }, (_, i) => cat(`c${i}`, 8 - i, i));

  it("caps the collapsed grid and says there is more", () => {
    const { tiles, hasMore } = categoryTiles(eight, false);
    expect(tiles).toHaveLength(CATEGORY_TILE_CAP);
    expect(hasMore).toBe(true);
  });

  it("shows everything when expanded", () => {
    expect(categoryTiles(eight, true).tiles).toHaveLength(8);
  });

  it("has no more to show at exactly the cap — the toggle must not render", () => {
    const { tiles, hasMore } = categoryTiles(eight.slice(0, CATEGORY_TILE_CAP), false);
    expect(tiles).toHaveLength(CATEGORY_TILE_CAP);
    expect(hasMore).toBe(false);
  });
});

describe("categoryIcon", () => {
  it("resolves the backend's lucide names and falls back to Boxes", () => {
    expect(categoryIcon("Gamepad2")).toBe(Gamepad2);
    expect(categoryIcon("NotALucideIcon")).toBe(Boxes);
    expect(categoryIcon(null)).toBe(Boxes);
  });
});
