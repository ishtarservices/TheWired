import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A ruled list of browse facets: one row per kind (Space, Scene, Genre, Tag),
 * a fixed label column, and the options on a shared grid line.
 *
 * Used by Music home's Browse and Explore's Filter panel, so the two read as
 * the same object. Rows are separated by hairlines, every option is the same
 * height, and the label sits on the first line of its options however many
 * lines they wrap to.
 */
export function FacetList({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={cn("divide-y divide-border-light border-t border-border-light", className)}>
      {children}
    </div>
  );
}

export function FacetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 py-1.5">
      <h2 className="label-caps flex h-7 items-center">{label}</h2>
      {/* -ml-2 cancels the option padding, so option text starts on the column edge */}
      <div className="-ml-2 flex flex-wrap items-center gap-x-0.5 gap-y-0.5">{children}</div>
    </div>
  );
}

export function FacetChip({
  active = false,
  count,
  leading,
  title,
  onClick,
  children,
}: {
  /** Pressed state, for filters. Omit for plain links. */
  active?: boolean;
  count?: number;
  /** An avatar or glyph before the label. */
  leading?: ReactNode;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active || undefined}
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors",
        active
          ? "bg-heading text-background"
          : "text-soft hover:bg-surface-hover hover:text-heading",
      )}
    >
      {leading}
      <span className="truncate">{children}</span>
      {count !== undefined && (
        <span className={cn("readout text-[10px]", active ? "opacity-60" : "text-muted")}>{count}</span>
      )}
    </button>
  );
}
