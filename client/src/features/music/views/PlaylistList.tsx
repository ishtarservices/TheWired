import { useMemo } from "react";
import { ListMusic, Plus } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";

export function PlaylistList() {
  const dispatch = useAppDispatch();
  const playlists = useAppSelector((s) => s.music.playlists);
  const userPlaylistIds = useAppSelector((s) => s.music.library.userPlaylists);

  const displayPlaylists = useMemo(() => {
    if (userPlaylistIds.length > 0) {
      return userPlaylistIds.map((id) => playlists[id]).filter(Boolean);
    }
    return Object.values(playlists).sort((a, b) => b.createdAt - a.createdAt);
  }, [userPlaylistIds, playlists]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-heading">Playlists</h2>
        <button className="flex items-center gap-1.5 rounded-md border border-edge px-3 py-1.5 text-sm text-soft transition-colors hover:border-heading hover:text-heading">
          <Plus size={14} />
          <span>Create</span>
        </button>
      </div>

      {displayPlaylists.length === 0 ? (
        <div className="flex flex-1 items-center justify-center pt-20">
          <p className="text-sm text-soft">No playlists yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          {displayPlaylists.map((pl) => (
            <button
              key={pl.addressableId}
              onClick={() =>
                dispatch(
                  setActiveDetailId({
                    view: "playlist-detail",
                    id: pl.addressableId,
                  }),
                )
              }
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-card-hover/30"
            >
              {pl.imageUrl ? (
                <img
                  src={pl.imageUrl}
                  alt={pl.title}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-card">
                  <ListMusic size={18} className="text-muted" />
                </div>
              )}
              <div className="min-w-0 text-left">
                <p className="truncate text-sm text-heading">{pl.title}</p>
                <p className="truncate text-xs text-soft">
                  {pl.trackRefs.length} track{pl.trackRefs.length !== 1 ? "s" : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
