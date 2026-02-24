import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { AlbumCard } from "../AlbumCard";

export function AlbumGrid() {
  const albums = useAppSelector((s) => s.music.albums);
  const savedAlbumIds = useAppSelector((s) => s.music.library.savedAlbumIds);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);

  const displayAlbums = useMemo(() => {
    const all = Object.values(albums);
    const ownAlbums = myPubkey ? all.filter((a) => a.pubkey === myPubkey) : [];

    if (savedAlbumIds.length > 0) {
      const saved = savedAlbumIds.map((id) => albums[id]).filter(Boolean);
      // Merge own albums that aren't already in saved list
      const savedSet = new Set(savedAlbumIds);
      const extraOwn = ownAlbums.filter((a) => !savedSet.has(a.addressableId));
      return [...saved, ...extraOwn];
    }
    // When browsing all albums, show public + own (regardless of visibility)
    const ownSet = new Set(ownAlbums.map((a) => a.addressableId));
    const publicAlbums = all.filter((a) => a.visibility === "public" && !ownSet.has(a.addressableId));
    return [...ownAlbums, ...publicAlbums].sort((a, b) => b.createdAt - a.createdAt);
  }, [savedAlbumIds, albums, myPubkey]);

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
