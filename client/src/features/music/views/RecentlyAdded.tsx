import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { TrackRow } from "../TrackRow";

export function RecentlyAdded() {
  const tracks = useAppSelector((s) => s.music.tracks);

  const sortedTracks = useMemo(() => {
    return Object.values(tracks).sort((a, b) => b.createdAt - a.createdAt);
  }, [tracks]);

  const queueIds = sortedTracks.map((t) => t.addressableId);

  if (sortedTracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No recently added tracks</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-3 text-lg font-semibold text-heading">Recently Added</h2>

      <div className="grid grid-cols-[2rem_1fr_1fr_4rem] gap-4 border-b border-white/[0.04] px-3 pb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
        <span>#</span>
        <span>Title</span>
        <span>Genre</span>
        <span className="text-right">Time</span>
      </div>

      <div className="mt-1">
        {sortedTracks.map((track, i) => (
          <TrackRow
            key={track.addressableId}
            track={track}
            index={i}
            queueTracks={queueIds}
          />
        ))}
      </div>
    </div>
  );
}
