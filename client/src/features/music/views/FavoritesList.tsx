import { useMemo, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { selectFavoritedTracks, selectFavoritedAlbums } from "../musicSelectors";
import { TrackRow } from "../TrackRow";
import { AlbumCard } from "../AlbumCard";
import {
  sortTracks,
  sortAlbums,
  filterTracks,
  filterAlbums,
  TRACK_SORT_OPTIONS,
  ALBUM_SORT_OPTIONS,
} from "../sortMusic";
import { SortDropdown, FilterInput, SortableTrackHeader } from "../MusicSortBar";
import { useTrackSort, useAlbumSort } from "../useLibrarySort";

export function FavoritesList() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const favTracks = useAppSelector(selectFavoritedTracks);
  const favAlbums = useAppSelector(selectFavoritedAlbums);
  const trackSort = useTrackSort();
  const albumSort = useAlbumSort();
  const [filter, setFilter] = useState("");

  const tracks = useMemo(
    () => sortTracks(filterTracks(favTracks, filter), trackSort.key, trackSort.dir),
    [favTracks, filter, trackSort.key, trackSort.dir],
  );
  const albums = useMemo(
    () => sortAlbums(filterAlbums(favAlbums, filter), albumSort.key, albumSort.dir),
    [favAlbums, filter, albumSort.key, albumSort.dir],
  );
  const queueIds = tracks.map((t) => t.addressableId);

  if (favTracks.length === 0 && favAlbums.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">
          No favorites yet. Use the heart icon to mark songs and projects you love.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-heading">Favorites</h2>
        <div className="ml-auto">
          <FilterInput value={filter} onChange={setFilter} />
        </div>
      </div>

      {/* Favorited Albums */}
      {favAlbums.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              Projects ({albums.length})
            </h3>
            <div className="ml-auto">
              <SortDropdown
                value={albumSort.key}
                dir={albumSort.dir}
                options={ALBUM_SORT_OPTIONS}
                onChangeKey={albumSort.setKey}
                onToggleDir={albumSort.toggleDir}
              />
            </div>
          </div>
          {albums.length === 0 ? (
            <p className="px-1 py-4 text-sm text-soft">No projects match “{filter}”.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {albums.map((album) => (
                <AlbumCard key={album.addressableId} album={album} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Favorited Tracks */}
      {favTracks.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
              Songs ({tracks.length})
            </h3>
            <div className="ml-auto">
              <SortDropdown
                value={trackSort.key}
                dir={trackSort.dir}
                options={TRACK_SORT_OPTIONS}
                onChangeKey={trackSort.setKey}
                onToggleDir={trackSort.toggleDir}
              />
            </div>
          </div>
          <SortableTrackHeader sortKey={trackSort.key} dir={trackSort.dir} onSort={trackSort.sortByHeader} />
          <div className="mt-1">
            {tracks.length === 0 ? (
              <p className="px-3 py-4 text-sm text-soft">No songs match “{filter}”.</p>
            ) : (
              tracks.map((track, i) => (
                <TrackRow
                  key={track.addressableId}
                  track={track}
                  index={i}
                  queueTracks={queueIds}
                />
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
