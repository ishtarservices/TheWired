import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { selectLibraryAlbums } from "../musicSelectors";
import { AlbumCard } from "../AlbumCard";

export function AlbumGrid() {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const libraryAlbumsSelector = useMemo(() => selectLibraryAlbums(myPubkey), [myPubkey]);
  const displayAlbums = useAppSelector(libraryAlbumsSelector);

  if (displayAlbums.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No projects yet</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="mb-3 text-lg font-semibold text-heading">Projects</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {displayAlbums.map((album) => (
          <AlbumCard key={album.addressableId} album={album} />
        ))}
      </div>
    </div>
  );
}
