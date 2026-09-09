import { memo } from "react";
import { Rss, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import type { DiscoverSpace } from "@/lib/api/discover";
import { SignalLine } from "./SignalLine";

/**
 * One ranked directory row. `signal` is the why-line (spaceSignalLabel) — the
 * only thing that explains the row's position; member count and category are
 * facts the row already prints, so they never appear in it.
 */
export const SpaceRow = memo(function SpaceRow({
  space,
  signal,
  selected,
  onSelect,
}: {
  space: DiscoverSpace;
  signal: string | null;
  selected: boolean;
  onSelect: (space: DiscoverSpace) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(space)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl card-glass p-3 text-left transition-all duration-200",
        "hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        selected && "ring-1 ring-primary/40 border-primary/30",
      )}
    >
      <Avatar src={space.picture} alt={space.name} size="lg" className="rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-heading">{space.name}</h3>
          {/* Read-only spaces have no chat — say so before the click, not after. */}
          {space.mode === "read" && (
            <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              <Rss size={8} />
              Feed
            </span>
          )}
        </div>
        {space.about && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-soft">{space.about}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="flex items-center gap-1 font-mono text-[10px] tabular-nums text-faint">
            <Users size={11} />
            {space.memberCount}
          </span>
          {space.category && (
            <span className="truncate text-[10px] capitalize text-faint">
              {space.category.replace(/-/g, " ")}
            </span>
          )}
          <SignalLine label={signal} />
        </div>
      </div>
    </button>
  );
});
