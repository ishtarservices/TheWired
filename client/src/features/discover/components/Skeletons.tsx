import { cn } from "@/lib/utils";

function Block({ className }: { className?: string }) {
  return <div className={cn("rounded bg-surface-hover", className)} />;
}

/** Ruled-row placeholders (thumb + two lines), laid out like the lists they
 *  stand in for. */
export function RowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="col-span-full grid animate-pulse grid-cols-1 gap-x-8 @3xl:grid-cols-2"
      data-testid="row-skeleton"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border-light py-3">
          <Block className="h-10 w-10 rounded-md" />
          <div className="flex-1 space-y-2">
            <Block className="h-2.5 w-36" />
            <Block className="h-2 w-56 max-w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A line of facet-option placeholders. */
export function TileGridSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex h-7 animate-pulse items-center gap-3 pl-2" data-testid="tile-skeleton" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Block key={i} className={cn("h-2.5", i % 2 === 0 ? "w-16" : "w-24")} />
      ))}
    </div>
  );
}

/** Cover-wall placeholders (square covers + two lines). Pass the wall's own
 *  grid classes so the placeholders land on the same columns. */
export function WallSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("animate-pulse", className)} data-testid="wall-skeleton" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2.5">
          <Block className="aspect-square w-full rounded-lg" />
          <Block className="h-2.5 w-24" />
          <Block className="h-2 w-16" />
        </div>
      ))}
    </div>
  );
}
