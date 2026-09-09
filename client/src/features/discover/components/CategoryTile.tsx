import { memo } from "react";
import type { SpaceCategory } from "@/lib/api/discover";
import { categoryIcon } from "../categoryIcons";

// One browse tile: the category's glyph, its name, and the count in the mono
// reporting voice. Compact and horizontal so a row of them reads as a list
// of doors, not a wall of empty cards.

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
    <button
      type="button"
      onClick={() => onSelect(category.slug)}
      aria-label={`${category.name}, ${count}`}
      className="flex items-center gap-3 rounded-xl card-glass px-3 py-2.5 text-left transition-all duration-200 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon size={18} strokeWidth={1.75} className="text-primary-soft" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-heading">{category.name}</span>
        <span className="block truncate font-mono text-[10px] tabular-nums text-faint">{count}</span>
      </span>
    </button>
  );
});
