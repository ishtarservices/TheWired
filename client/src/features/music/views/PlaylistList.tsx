import { useMemo, useState } from "react";
import { ListMusic, Plus } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { CreatePlaylistModal } from "../CreatePlaylistModal";

export function PlaylistList() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const dispatch = useAppDispatch();
  const playlists = useAppSelector((s) => s.music.playlists);
  const userPlaylistIds = useAppSelector((s) => s.music.library.userPlaylists);
  const [createOpen, setCreateOpen] = useState(false);

  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const displayPlaylists = useMemo(() => {
    if (userPlaylistIds.length > 0) {
      return userPlaylistIds.map((id) => playlists[id]).filter(Boolean);
    }
    // Show only own playlists when user has no saved playlist IDs
    if (pubkey) {
      return Object.values(playlists)
        .filter((p) => p.pubkey === pubkey)
        .sort((a, b) => b.createdAt - a.createdAt);
    }
    return [];
  }, [userPlaylistIds, playlists, pubkey]);

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-heading">Playlists</h2>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading press-effect"
        >
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
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface"
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

      <CreatePlaylistModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
