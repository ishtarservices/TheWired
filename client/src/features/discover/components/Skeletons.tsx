import { cn } from "@/lib/utils";

function Block({ className }: { className?: string }) {
  return <div className={cn("rounded bg-card-hover/50", className)} />;
}

/** A ranked-row placeholder (cover + two lines). */
export function RowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2" data-testid="row-skeleton" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border-light p-3 animate-pulse">
          <Block className="h-12 w-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Block className="h-3 w-40" />
            <Block className="h-2.5 w-64" />
            <Block className="h-2 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A tile-grid placeholder. */
export function TileGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-3"
      data-testid="tile-skeleton"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl border border-border-light px-3 py-2.5 animate-pulse">
          <Block className="h-9 w-9 rounded-lg" />
          <div className="space-y-1.5">
            <Block className="h-3 w-20" />
            <Block className="h-2 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A horizontal rail placeholder (square covers). */
export function RailSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden" data-testid="rail-skeleton" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-36 shrink-0 space-y-2 animate-pulse">
          <Block className="aspect-square w-full rounded-lg" />
          <Block className="h-3 w-24" />
          <Block className="h-2 w-16" />
        </div>
      ))}
    </div>
  );
}
