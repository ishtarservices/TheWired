import { useMemo, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { selectLibraryAlbums } from "../musicSelectors";
import { AlbumCard } from "../AlbumCard";
import { sortAlbums, filterAlbums, ALBUM_SORT_OPTIONS } from "../sortMusic";
import { SortDropdown, FilterInput } from "../MusicSortBar";
import { useAlbumSort } from "../useLibrarySort";

export function AlbumGrid() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const libraryAlbumsSelector = useMemo(() => selectLibraryAlbums(myPubkey), [myPubkey]);
  const displayAlbums = useAppSelector(libraryAlbumsSelector);
  const sort = useAlbumSort();
  const [filter, setFilter] = useState("");

  const albums = useMemo(
    () => sortAlbums(filterAlbums(displayAlbums, filter), sort.key, sort.dir),
    [displayAlbums, filter, sort.key, sort.dir],
  );

  if (displayAlbums.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No projects yet</p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-heading">
          Projects <span className="text-sm font-normal text-muted">({albums.length})</span>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <FilterInput value={filter} onChange={setFilter} />
          <SortDropdown
            value={sort.key}
            dir={sort.dir}
            options={ALBUM_SORT_OPTIONS}
            onChangeKey={sort.setKey}
            onToggleDir={sort.toggleDir}
          />
        </div>
      </div>

      {albums.length === 0 ? (
        <p className="px-1 py-6 text-sm text-soft">No projects match “{filter}”.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {albums.map((album) => (
            <AlbumCard key={album.addressableId} album={album} />
          ))}
        </div>
      )}
    </div>
  );
}
