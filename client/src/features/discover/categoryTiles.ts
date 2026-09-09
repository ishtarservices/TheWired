import type { SpaceCategory } from "@/lib/api/discover";

// The browse grid's vocabulary — pure, no React.
//
// Only categories with something behind them earn a tile (a tile leading to an
// empty list reads as a broken app, same rule as sceneChips). Busiest first so
// the capped grid shows where people actually are; the backend's position
// breaks ties so the order is stable between fetches.

export const CATEGORY_TILE_CAP = 6;

export function visibleCategories(categories: readonly SpaceCategory[]): SpaceCategory[] {
  return categories
    .filter((c) => c.spaceCount > 0)
    .sort((a, b) => {
      if (b.spaceCount !== a.spaceCount) return b.spaceCount - a.spaceCount;
      if (a.position !== b.position) return a.position - b.position;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
}

export interface CategoryTiles {
  tiles: SpaceCategory[];
  /** More tiles exist than the cap shows — gates the "All categories" toggle
   *  so it is never a dead control. */
  hasMore: boolean;
}

export function categoryTiles(
  categories: readonly SpaceCategory[],
  expanded: boolean,
  cap = CATEGORY_TILE_CAP,
): CategoryTiles {
  const visible = visibleCategories(categories);
  const hasMore = visible.length > cap;
  return { tiles: expanded || !hasMore ? visible : visible.slice(0, cap), hasMore };
}
