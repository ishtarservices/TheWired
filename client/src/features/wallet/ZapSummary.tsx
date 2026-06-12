import { useMemo, useState } from "react";
import { Zap, ChevronRight } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { selectZapMap, aggregateZaps } from "@/store/slices/zapsSlice";
import { ZapListModal } from "./ZapListModal";

/**
 * Compact, click-to-expand zap summary for a note: total sats + a preview of the
 * most recent comment, opening the full zapper list on click. Renders nothing
 * until the event has at least one zap, so it never clutters un-zapped notes.
 */
export function ZapSummary({ eventId, className }: { eventId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const map = useAppSelector((s) => selectZapMap(s, eventId));
  const { count, sats, recent } = useMemo(() => aggregateZaps(map), [map]);

  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="See who zapped"
        className={`flex max-w-full items-center gap-1.5 rounded-full border border-yellow-400/20 bg-yellow-400/[0.06] px-2.5 py-1 text-xs text-yellow-400/90 transition-colors hover:bg-yellow-400/[0.12] ${className ?? ""}`}
      >
        <Zap size={12} className="shrink-0" fill="currentColor" />
        <span className="shrink-0 font-semibold">{sats.toLocaleString()}</span>
        {recent?.comment.trim() ? (
          <span className="min-w-0 flex-1 truncate text-left text-muted">
            {recent.comment}
          </span>
        ) : (
          <span className="flex-1 text-left text-muted">
            {count === 1 ? "zap" : `${count} zaps`}
          </span>
        )}
        <ChevronRight size={13} className="shrink-0 text-muted" />
      </button>
      {open && <ZapListModal eventId={eventId} onClose={() => setOpen(false)} />}
    </>
  );
}
