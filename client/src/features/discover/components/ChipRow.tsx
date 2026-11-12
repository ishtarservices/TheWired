import { cn } from "@/lib/utils";

export interface ChipOption<V extends string = string> {
  value: V;
  label: string;
  /** Optional trailing count, in the mono readout voice. */
  count?: number;
}

interface ChipRowProps<V extends string> {
  options: ChipOption<V>[];
  value: V | null;
  onSelect: (value: V) => void;
  /** Accessible name for the group. */
  label: string;
  /**
   * `chips` are filter options (the same object as the music section's
   * `FacetChip`, so they sit inside a `FacetRow`); `text` is a plain row of
   * words for switching a view or a sort.
   */
  variant?: "chips" | "text";
  /** `text` only: `md` for page tabs, `sm` for a sort. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * One choice out of a few. Wraps instead of scrolling: on desktop there is
 * width to spare, and a horizontal scroll container clips in WebKit. The
 * active option is a fact about the current view, not a call to action, so it
 * is marked in the neutral ink, never the accent colour.
 */
export function ChipRow<V extends string>({
  options,
  value,
  onSelect,
  label,
  variant = "chips",
  size = "md",
  className,
}: ChipRowProps<V>) {
  if (options.length === 0) return null;
  const text = variant === "text";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center",
        text ? (size === "sm" ? "gap-x-3 gap-y-1 text-xs" : "gap-x-4 gap-y-1 text-[13px]") : "gap-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(opt.value)}
            className={cn(
              "transition-colors",
              text
                ? cn(
                    "rounded-sm",
                    active
                      ? cn("text-heading", size === "md" && "font-medium")
                      : "text-muted hover:text-heading",
                  )
                : cn(
                    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-[13px]",
                    active
                      ? "bg-heading text-background"
                      : "text-soft hover:bg-surface-hover hover:text-heading",
                  ),
            )}
          >
            <span className="truncate">{opt.label}</span>
            {opt.count !== undefined && opt.count > 0 && (
              <span className={cn("readout text-[10px]", active ? "opacity-60" : "text-muted")}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
