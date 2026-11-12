import { memo } from "react";
import type { SpaceCategory } from "@/lib/api/discover";
import { CategoryTile } from "./CategoryTile";

// The categories as one wrapping line of facet options. memo'd with stable
// props on purpose: the segment re-renders on every keystroke of the shared
// search box and this subtree must bail out.

export const CategoryGrid = memo(function CategoryGrid({
  tiles,
  onSelect,
}: {
  tiles: SpaceCategory[];
  onSelect: (slug: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5" data-testid="category-grid">
      {tiles.map((c) => (
        <CategoryTile key={c.slug} category={c} onSelect={onSelect} />
      ))}
    </div>
  );
});
