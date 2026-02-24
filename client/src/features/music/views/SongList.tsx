import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { TrackRow } from "../TrackRow";

export function SongList() {
  const tracks = useAppSelector((s) => s.music.tracks);
  const savedTrackIds = useAppSelector((s) => s.music.library.savedTrackIds);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);

  const allTracks = useMemo(() => {
    const all = Object.values(tracks);
    const ownTracks = myPubkey ? all.filter((t) => t.pubkey === myPubkey) : [];

    if (savedTrackIds.length > 0) {
      const saved = savedTrackIds.map((id) => tracks[id]).filter(Boolean);
      // Merge own tracks that aren't already in saved list
      const savedSet = new Set(savedTrackIds);
      const extraOwn = ownTracks.filter((t) => !savedSet.has(t.addressableId));
      return [...saved, ...extraOwn];
    }
    // Fallback: show public + own (regardless of visibility)
    const ownSet = new Set(ownTracks.map((t) => t.addressableId));
    const publicTracks = all.filter((t) => t.visibility === "public" && !ownSet.has(t.addressableId));
    return [...ownTracks, ...publicTracks].sort((a, b) => b.createdAt - a.createdAt);
  }, [savedTrackIds, tracks, myPubkey]);

  const queueIds = allTracks.map((t) => t.addressableId);

  if (allTracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No songs yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-3 text-lg font-semibold text-heading">Songs</h2>

      {/* Column headers */}
      <div className="grid grid-cols-[2rem_1fr_1fr_4rem_2rem] gap-4 border-b border-edge px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span>#</span>
        <span>Title</span>
        <span>Genre</span>
        <span className="text-right">Time</span>
        <span />
      </div>

      <div className="mt-1">
        {allTracks.map((track, i) => (
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
