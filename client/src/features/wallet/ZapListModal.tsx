import { useMemo } from "react";
import { Zap, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useAppSelector } from "@/store/hooks";
import {
  selectZapMap,
  sortedZapEntries,
  aggregateZaps,
  type ZapReceiptEntry,
} from "@/store/slices/zapsSlice";

/** Full list of zaps on an event: who zapped, how much, and their comment.
 *  Cross-client — every NIP-57 receipt we've seen for this event. */
export function ZapListModal({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const map = useAppSelector((s) => selectZapMap(s, eventId));
  const entries = useMemo(() => sortedZapEntries(map), [map]);
  const { sats, count } = useMemo(() => aggregateZaps(map), [map]);

  return (
    <Modal open onClose={onClose}>
      <div className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-2xl border-gradient card-glass p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-heading">
            <Zap size={16} className="text-yellow-400" fill="currentColor" />
            {sats.toLocaleString()} sats
            <span className="text-sm font-normal text-muted">
              · {count} {count === 1 ? "zap" : "zaps"}
            </span>
          </h2>
          <button
            onClick={onClose}
            className="text-muted transition-colors hover:text-heading"
          >
            <X size={16} />
          </button>
        </div>

        <div className="-mx-1 flex-1 space-y-0.5 overflow-y-auto px-1">
          {entries.map((e, i) => (
            <ZapListRow key={i} entry={e} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function ZapListRow({ entry }: { entry: ZapReceiptEntry }) {
  const { profile } = useProfile(entry.zapper);
  const sats = Math.floor(entry.msat / 1000);
  const name = entry.zapper
    ? profile?.display_name || profile?.name || entry.zapper.slice(0, 8) + "…"
    : "Anonymous";

  return (
    <div className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-surface-hover">
      <Avatar
        src={entry.zapper ? profile?.picture : undefined}
        alt={name}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-heading">{name}</span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-yellow-400">
            <Zap size={11} fill="currentColor" />
            {sats.toLocaleString()}
          </span>
        </div>
        {entry.comment.trim() && (
          // Plain text only — the embedded comment is untrusted.
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-soft">
            {entry.comment}
          </p>
        )}
      </div>
    </div>
  );
}
