import { useMemo, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { selectLibraryTracks } from "../musicSelectors";
import { TrackRow } from "../TrackRow";
import { sortTracks, filterTracks, TRACK_SORT_OPTIONS } from "../sortMusic";
import { SortDropdown, FilterInput, SortableTrackHeader } from "../MusicSortBar";
import { useTrackSort } from "../useLibrarySort";

export function SongList() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const libraryTracksSelector = useMemo(() => selectLibraryTracks(myPubkey), [myPubkey]);
  const allTracks = useAppSelector(libraryTracksSelector);
  const sort = useTrackSort();
  const [filter, setFilter] = useState("");

  const rows = useMemo(
    () => sortTracks(filterTracks(allTracks, filter), sort.key, sort.dir),
    [allTracks, filter, sort.key, sort.dir],
  );
  const queueIds = rows.map((t) => t.addressableId);

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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-heading">
          Songs <span className="text-sm font-normal text-muted">({rows.length})</span>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <FilterInput value={filter} onChange={setFilter} />
          <SortDropdown
            value={sort.key}
            dir={sort.dir}
            options={TRACK_SORT_OPTIONS}
            onChangeKey={sort.setKey}
            onToggleDir={sort.toggleDir}
          />
        </div>
      </div>

      <SortableTrackHeader sortKey={sort.key} dir={sort.dir} onSort={sort.sortByHeader} />

      <div className="mt-1">
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-sm text-soft">No songs match “{filter}”.</p>
        ) : (
          rows.map((track, i) => (
            <TrackRow
              key={track.addressableId}
              track={track}
              index={i}
              queueTracks={queueIds}
            />
          ))
        )}
      </div>
    </div>
  );
}
