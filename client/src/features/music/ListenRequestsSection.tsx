import { useMemo } from "react";
import { Inbox } from "lucide-react";
import { ListenRequestRow } from "./ListenRequestRow";
import { useIncomingListenRequests } from "./useListenRequests";

/**
 * Listen requests against one release (and, for a project, its tracks), on
 * the owner's own detail screen. Renders nothing when there are none.
 */
export function ListenRequestsSection({ targetRefs }: { targetRefs: string[] }) {
  const { groups } = useIncomingListenRequests();
  const key = targetRefs.join("|");
  const rows = useMemo(() => {
    const refs = new Set(key.split("|"));
    return groups.filter((g) => refs.has(g.targetRef));
  }, [groups, key]);

  if (rows.length === 0) return null;

  return (
    <div className="mx-6 mt-2 rounded-xl border border-border card-glass p-2">
      <div className="mb-1 flex items-center gap-2 px-3 pt-1 text-xs font-semibold text-soft">
        <Inbox size={14} />
        Listen Requests ({rows.length})
      </div>
      {rows.map((g) => (
        <ListenRequestRow key={g.key} group={g} />
      ))}
    </div>
  );
}
