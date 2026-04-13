import { useState, useMemo } from "react";
import { X, Search, Check, ListMusic, Disc3 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { selectLibraryTracks, selectLibraryAlbums } from "@/features/music/musicSelectors";
import { getTrackImage } from "@/features/music/trackImage";
import { useResolvedArtist } from "@/features/music/useResolvedArtist";
import { useProfileShowcase } from "./useProfileShowcase";
import { MAX_SHOWCASE_ITEMS } from "./profileShowcase";
import type { MusicTrack, MusicAlbum } from "@/types/music";

function ShowcaseTrackArtist({ track }: { track: MusicTrack }) {
  const resolved = useResolvedArtist(track.artist, track.artistPubkeys);
  return <>{resolved}</>;
}

function ShowcaseAlbumArtist({ album }: { album: MusicAlbum }) {
  const resolved = useResolvedArtist(album.artist, album.artistPubkeys);
  return <>{resolved}</>;
}

interface ShowcasePickerModalProps {
  open: boolean;
  onClose: () => void;
}

type PickerTab = "tracks" | "albums";

export function ShowcasePickerModal({ open, onClose }: ShowcasePickerModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const albums = useAppSelector((s) => s.music.albums);

  const selectTracks = useMemo(
    () => selectLibraryTracks(pubkey),
    [pubkey],
  );
  const selectAlbums = useMemo(
    () => selectLibraryAlbums(pubkey),
    [pubkey],
  );
  const libraryTracks = useAppSelector(selectTracks);
  const libraryAlbums = useAppSelector(selectAlbums);

  const { showcase, addItem, removeItem, isInShowcase } = useProfileShowcase(pubkey);

  const [tab, setTab] = useState<PickerTab>("tracks");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const atLimit = showcase.items.length >= MAX_SHOWCASE_ITEMS;

  const filteredTracks = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return libraryTracks;
    return libraryTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q),
    );
  }, [libraryTracks, query]);

  const filteredAlbums = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return libraryAlbums;
    return libraryAlbums.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.artist.toLowerCase().includes(q),
    );
  }, [libraryAlbums, query]);

  const handleToggle = async (type: "track" | "album", addressableId: string) => {
    if (adding) return;
    setAdding(addressableId);
    try {
      if (isInShowcase(addressableId)) {
        await removeItem(addressableId);
      } else if (!atLimit) {
        await addItem({ type, addressableId });
      }
    } catch {
      // Silently fail
    } finally {
      setAdding(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden rounded-2xl border border-border card-glass shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-heading">Add to Library</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <Search size={14} className="text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your library..."
              className="flex-1 bg-transparent text-sm text-heading placeholder-muted outline-none"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/40 px-5">
          <button
            onClick={() => setTab("tracks")}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              tab === "tracks"
                ? "border-b-2 border-primary text-primary"
                : "text-muted hover:text-soft"
            }`}
          >
            Tracks ({filteredTracks.length})
          </button>
          <button
            onClick={() => setTab("albums")}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              tab === "albums"
                ? "border-b-2 border-primary text-primary"
                : "text-muted hover:text-soft"
            }`}
          >
            Projects ({filteredAlbums.length})
          </button>
        </div>

        {/* Item count */}
        <div className="px-5 py-2 text-[11px] text-muted">
          {showcase.items.length}/{MAX_SHOWCASE_ITEMS} items
          {atLimit && (
            <span className="ml-1 text-amber-400">(limit reached)</span>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {tab === "tracks" && (
            <div className="space-y-1">
              {filteredTracks.length === 0 ? (
                <p className="py-6 text-center text-sm text-soft">
                  {query ? "No matches" : "No tracks in your library"}
                </p>
              ) : (
                filteredTracks.map((track) => {
                  const inShowcase = isInShowcase(track.addressableId);
                  const isToggling = adding === track.addressableId;
                  const imageUrl = getTrackImage(track, albums);

                  return (
                    <button
                      key={track.addressableId}
                      onClick={() => handleToggle("track", track.addressableId)}
                      disabled={(!inShowcase && atLimit) || isToggling}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={track.title}
                          className="h-8 w-8 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-card">
                          <ListMusic size={14} className="text-muted" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm text-heading">{track.title}</p>
                        <p className="truncate text-xs text-soft"><ShowcaseTrackArtist track={track} /></p>
                      </div>
                      {isToggling ? (
                        <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      ) : inShowcase ? (
                        <Check size={16} className="shrink-0 text-green-400" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {tab === "albums" && (
            <div className="space-y-1">
              {filteredAlbums.length === 0 ? (
                <p className="py-6 text-center text-sm text-soft">
                  {query ? "No matches" : "No projects in your library"}
                </p>
              ) : (
                filteredAlbums.map((album) => {
                  const inShowcase = isInShowcase(album.addressableId);
                  const isToggling = adding === album.addressableId;

                  return (
                    <button
                      key={album.addressableId}
                      onClick={() => handleToggle("album", album.addressableId)}
                      disabled={(!inShowcase && atLimit) || isToggling}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface-hover disabled:opacity-50"
                    >
                      {album.imageUrl ? (
                        <img
                          src={album.imageUrl}
                          alt={album.title}
                          className="h-8 w-8 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-card">
                          <Disc3 size={14} className="text-muted" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm text-heading">{album.title}</p>
                        <p className="truncate text-xs text-soft">
                          <ShowcaseAlbumArtist album={album} /> · {album.trackCount} track{album.trackCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      {isToggling ? (
                        <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      ) : inShowcase ? (
                        <Check size={16} className="shrink-0 text-green-400" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
