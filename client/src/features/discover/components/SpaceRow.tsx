import { memo } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import type { DiscoverSpace } from "@/lib/api/discover";
import { SignalLine } from "./SignalLine";

/**
 * One ranked directory row, ruled off from the next by a hairline rather than
 * boxed. `signal` is the why-line (spaceSignalLabel): the only thing that
 * explains the row's position. Member count and category are facts the row
 * already prints, so they never appear in it.
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
    <div className="border-b border-border-light py-1">
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(space)}
        className={cn(
          "-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors",
          selected ? "bg-surface-hover" : "hover:bg-surface-hover",
        )}
      >
        <Avatar src={space.picture} alt={space.name} size="lg" className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[13px] font-medium text-heading">{space.name}</h3>
            {/* Read-only spaces have no chat: say so before the click, not after. */}
            {space.mode === "read" && (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-faint">Feed</span>
            )}
          </div>
          {space.about && (
            <p className="mt-0.5 line-clamp-2 text-xs leading-[1.45] text-muted">{space.about}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-faint">
            <span className="readout">
              {space.memberCount} {space.memberCount === 1 ? "member" : "members"}
            </span>
            {space.category && (
              <span className="truncate capitalize">{space.category.replace(/-/g, " ")}</span>
            )}
            <SignalLine label={signal} />
          </div>
        </div>
      </button>
    </div>
  );
});
