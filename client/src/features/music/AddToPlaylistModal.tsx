import { useState } from "react";
import { X, ListMusic, Check, ChevronLeft } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { selectUserPlaylists } from "./musicSelectors";
import { addPlaylist } from "@/store/slices/musicSlice";
import { buildPlaylistEvent } from "./musicEventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

interface AddToPlaylistModalProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  trackAddrId: string;
}

export function AddToPlaylistModal({ open, onClose, onBack, trackAddrId }: AddToPlaylistModalProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const playlists = useAppSelector(selectUserPlaylists);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const handleAdd = async (playlistId: string) => {
    if (!pubkey || adding) return;

    const playlist = playlists.find((p) => p.addressableId === playlistId);
    if (!playlist) return;

    // Check if track is already in playlist
    if (playlist.trackRefs.includes(trackAddrId)) return;

    setAdding(playlistId);
    try {
      const dTag = playlist.addressableId.split(":").slice(2).join(":");
      const newTrackRefs = [...playlist.trackRefs, trackAddrId];
      const unsigned = buildPlaylistEvent(pubkey, {
        title: playlist.title,
        description: playlist.description,
        slug: dTag,
        trackRefs: newTrackRefs,
        imageUrl: playlist.imageUrl,
      });
      const published = await signAndPublish(unsigned);
      dispatch(addPlaylist({
        ...playlist,
        trackRefs: newTrackRefs,
        eventId: published.id,
        createdAt: published.created_at,
      }));
      setAdded((prev) => new Set(prev).add(playlistId));
    } catch {
      // Silently fail
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="text-soft hover:text-heading">
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="text-lg font-semibold text-heading">Add to Playlist</h2>
          </div>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        {playlists.length === 0 ? (
          <p className="py-4 text-center text-sm text-soft">
            No playlists yet. Create one first.
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {playlists.map((pl) => {
              const alreadyIn = pl.trackRefs.includes(trackAddrId) || added.has(pl.addressableId);
              const isAdding = adding === pl.addressableId;

              return (
                <button
                  key={pl.addressableId}
                  onClick={() => !alreadyIn && handleAdd(pl.addressableId)}
                  disabled={alreadyIn || isAdding}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface disabled:opacity-60"
                >
                  {pl.imageUrl ? (
                    <img
                      src={pl.imageUrl}
                      alt={pl.title}
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-card">
                      <ListMusic size={14} className="text-muted" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm text-heading">{pl.title}</p>
                    <p className="truncate text-xs text-soft">
                      {pl.trackRefs.length} track{pl.trackRefs.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {alreadyIn && (
                    <Check size={16} className="shrink-0 text-green-400" />
                  )}
                  {isAdding && (
                    <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
