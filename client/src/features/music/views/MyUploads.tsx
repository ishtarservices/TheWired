import { useState, useMemo } from "react";
import { Upload, Disc3 } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { selectMyTracks, selectMyAlbums, selectMyCollaborations } from "../musicSelectors";
import { TrackRow } from "../TrackRow";
import { AlbumCard } from "../AlbumCard";
import { UploadTrackModal } from "../UploadTrackModal";
import { CreateAlbumModal } from "../CreateAlbumModal";
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

export function MyUploads() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const myTracks = useAppSelector(
    useMemo(() => (pubkey ? selectMyTracks(pubkey) : () => []), [pubkey]),
  );
  const myAlbums = useAppSelector(
    useMemo(() => (pubkey ? selectMyAlbums(pubkey) : () => []), [pubkey]),
  );
  const myCollabs = useAppSelector(
    useMemo(() => (pubkey ? selectMyCollaborations(pubkey) : () => []), [pubkey]),
  );
  const trackSort = useTrackSort();
  const albumSort = useAlbumSort();
  const [filter, setFilter] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);

  const tracks = useMemo(
    () => sortTracks(filterTracks(myTracks, filter), trackSort.key, trackSort.dir),
    [myTracks, filter, trackSort.key, trackSort.dir],
  );
  const albums = useMemo(
    () => sortAlbums(filterAlbums(myAlbums, filter), albumSort.key, albumSort.dir),
    [myAlbums, filter, albumSort.key, albumSort.dir],
  );
  const collabs = useMemo(
    () => sortAlbums(filterAlbums(myCollabs, filter), albumSort.key, albumSort.dir),
    [myCollabs, filter, albumSort.key, albumSort.dir],
  );
  const queueIds = tracks.map((t) => t.addressableId);

  if (!pubkey) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Sign in to see your uploads</p>
      </div>
    );
  }

  const isEmpty = myTracks.length === 0 && myAlbums.length === 0 && myCollabs.length === 0;

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-heading">My Music</h2>
        <div className="ml-auto flex items-center gap-2">
          {!isEmpty && <FilterInput value={filter} onChange={setFilter} />}
          <button
            onClick={() => setAlbumOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:border-border-light hover:text-heading press-effect"
          >
            <Disc3 size={14} />
            Create Project
          </button>
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary-soft px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 press-effect"
          >
            <Upload size={14} />
            Upload Track
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Upload size={32} className="text-muted" />
          <p className="text-sm text-soft">You haven't uploaded any music yet</p>
          <button
            onClick={() => setUploadOpen(true)}
            className="rounded-xl bg-gradient-to-r from-primary to-primary-soft px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect"
          >
            Upload Your First Track
          </button>
        </div>
      ) : (
        <>
          {myAlbums.length > 0 && (
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-soft">Projects ({albums.length})</h3>
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
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                  {albums.map((album) => (
                    <AlbumCard key={album.addressableId} album={album} />
                  ))}
                </div>
              )}
            </div>
          )}

          {myCollabs.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-soft">Collaborations ({collabs.length})</h3>
              {collabs.length === 0 ? (
                <p className="px-1 py-4 text-sm text-soft">No collaborations match “{filter}”.</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                  {collabs.map((album) => (
                    <AlbumCard key={album.addressableId} album={album} />
                  ))}
                </div>
              )}
            </div>
          )}

          {myTracks.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-soft">Tracks ({tracks.length})</h3>
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
                  <p className="px-3 py-4 text-sm text-soft">No tracks match “{filter}”.</p>
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
            </div>
          )}
        </>
      )}

      <UploadTrackModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <CreateAlbumModal open={albumOpen} onClose={() => setAlbumOpen(false)} />
    </div>
  );
}
