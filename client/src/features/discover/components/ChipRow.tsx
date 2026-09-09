import { cn } from "@/lib/utils";

export interface ChipOption<V extends string = string> {
  value: V;
  label: string;
  /** Optional trailing count, rendered in the muted mono voice. */
  count?: number;
}

interface ChipRowProps<V extends string> {
  options: ChipOption<V>[];
  value: V | null;
  onSelect: (value: V) => void;
  /** Accessible name for the group. */
  label: string;
  /** `segmented` renders one joined control (tabs, sort); `chips` wraps free pills. */
  variant?: "chips" | "segmented";
  size?: "sm" | "md";
  /** Small mono caption printed before the chips (e.g. "Scenes"). */
  caption?: string;
  className?: string;
}

/**
 * A row of selectable chips. Wraps instead of scrolling — on desktop there is
 * width to spare, and a horizontal scroll container clips the pills' bottom
 * edge in WebKit. The active chip is a fact about the current filter, not a
 * call to action, so it uses the quiet primary tint.
 */
export function ChipRow<V extends string>({
  options,
  value,
  onSelect,
  label,
  variant = "chips",
  size = "md",
  caption,
  className,
}: ChipRowProps<V>) {
  if (options.length === 0) return null;
  const segmented = variant === "segmented";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {caption && (
        <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-faint">{caption}</span>
      )}
      <div
        role="group"
        aria-label={label}
        className={cn(
          "flex flex-wrap items-center",
          segmented ? "gap-0.5 rounded-xl bg-field p-1 ring-1 ring-border" : "gap-2",
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
                "shrink-0 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
                segmented ? "rounded-lg" : "rounded-full",
                active
                  ? segmented
                    ? "bg-primary/20 text-primary"
                    : "bg-primary/20 text-primary ring-1 ring-primary/40"
                  : segmented
                    ? "text-soft hover:bg-card-hover hover:text-heading"
                    : "bg-card text-soft ring-1 ring-border-light hover:bg-card-hover hover:text-heading",
              )}
            >
              {opt.label}
              {opt.count !== undefined && opt.count > 0 && (
                <span className="ml-1 font-mono text-[10px] tabular-nums text-muted">{opt.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
