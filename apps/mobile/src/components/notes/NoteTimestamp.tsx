import { memo } from "react";

import { Type } from "@/components/ui/Type";
import { formatRelativeTime } from "@/lib/time";
import { useMinuteTick } from "@/lib/timeTick";

// Relative-time leaf for memo'd note rows: NoteCard renders once, so a plain
// inline timestamp would show "6m" forever. This leaf subscribes to the
// app-wide minute tick — the only thing that re-renders each minute.

export const NoteTimestamp = memo(function NoteTimestamp({ createdAt }: { createdAt: number }) {
  const minute = useMinuteTick();
  return (
    <Type role="meta" tabular className="text-faint">
      {formatRelativeTime(createdAt, minute * 60_000)}
    </Type>
  );
});
