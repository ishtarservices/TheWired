import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { selectLibraryTracks } from "../musicSelectors";
import { TrackRow } from "../TrackRow";

export function SongList() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const libraryTracksSelector = useMemo(() => selectLibraryTracks(myPubkey), [myPubkey]);
  const allTracks = useAppSelector(libraryTracksSelector);

  const queueIds = allTracks.map((t) => t.addressableId);

  if (allTracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">
          Your library is empty. Save tracks or upload your own music.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <h2 className="mb-3 text-lg font-semibold text-heading">Songs</h2>

      {/* Column headers */}
      <div className="grid grid-cols-[2rem_1fr_1fr_4rem_2rem] gap-4 border-b border-border px-3 pb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
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
