import { memo } from "react";
import type { SpaceCategory } from "@/lib/api/discover";
import { FacetChip } from "@/features/music/Facets";
import { categoryIcon } from "../categoryIcons";

// One category as a facet option: its glyph, its name, and how many spaces
// are behind it in the mono readout voice.

export const CategoryTile = memo(function CategoryTile({
  category,
  onSelect,
}: {
  category: SpaceCategory;
  onSelect: (slug: string) => void;
}) {
  const Icon = categoryIcon(category.icon);
  const count = `${category.spaceCount} ${category.spaceCount === 1 ? "space" : "spaces"}`;
  return (
    <FacetChip
      onClick={() => onSelect(category.slug)}
      ariaLabel={`${category.name}, ${count}`}
      leading={<Icon size={13} strokeWidth={1.75} className="shrink-0 text-muted" />}
      count={category.spaceCount}
    >
      {category.name}
    </FacetChip>
  );
});
