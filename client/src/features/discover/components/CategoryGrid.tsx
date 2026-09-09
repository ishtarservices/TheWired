import { memo } from "react";
import type { SpaceCategory } from "@/lib/api/discover";
import { CategoryTile } from "./CategoryTile";

// Wrapping CSS grid of category tiles. memo'd with stable props on purpose:
// the segment re-renders on every keystroke of the shared search box and this
// subtree must bail out.

export const CategoryGrid = memo(function CategoryGrid({
  tiles,
  onSelect,
}: {
  tiles: SpaceCategory[];
  onSelect: (slug: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-3" data-testid="category-grid">
      {tiles.map((c) => (
        <CategoryTile key={c.slug} category={c} onSelect={onSelect} />
      ))}
    </div>
  );
});
