import { useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { FacetList } from "@/features/music/Facets";

const STORAGE_PREFIX = "thewired_discover_browse_";

function readOpen(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

/**
 * The foldable Browse block that leads a Discover tab: ways in (scene,
 * category, genre), not content. Same control and same ruled facet list as
 * Music home's Browse, so the two read as one object. Whether it is open is
 * remembered per tab.
 *
 * `active` is shown beside the label while the block is folded, so a filter
 * that is in use never disappears from the page.
 */
export function Browse({
  id,
  storageKey,
  defaultOpen,
  active,
  children,
}: {
  id: string;
  storageKey: string;
  defaultOpen: boolean;
  active?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const toggle = () =>
    setOpen((was) => {
      const next = !was;
      try {
        localStorage.setItem(STORAGE_PREFIX + storageKey, next ? "1" : "0");
      } catch {
        // storage unavailable: the choice just isn't remembered
      }
      return next;
    });

  return (
    <section>
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={id}
          className="group -ml-1 flex h-7 items-center gap-1.5 rounded-md px-1"
        >
          <ChevronRight
            size={10}
            className={`text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          <span className="label-caps transition-colors group-hover:text-heading">Browse</span>
        </button>
        {!open && active}
      </div>
      {open && (
        <FacetList id={id} className="animate-fade-in mt-2 border-b">
          {children}
        </FacetList>
      )}
    </section>
  );
}

/** A filter that is in use, with its own remove control. */
export function ActiveFilter({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs text-heading">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${label} filter`}
        className="rounded-full p-0.5 text-muted hover:bg-surface-hover hover:text-heading"
      >
        <X size={12} />
      </button>
    </span>
  );
}
