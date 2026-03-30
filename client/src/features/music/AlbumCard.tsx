import { memo, useState } from "react";
import { Disc3, MoreHorizontal, Play } from "lucide-react";
import type { MusicAlbum } from "@/types/music";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { CreateAlbumModal } from "./CreateAlbumModal";
import { AlbumActionPanel } from "./AlbumActionPanel";
import { useAudioPlayer } from "./useAudioPlayer";
import { UpdateAvailableBadge } from "./UpdateAvailableBadge";

interface AlbumCardProps {
  album: MusicAlbum;
  onNavigate?: () => void;
}

export const AlbumCard = memo(function AlbumCard({ album, onNavigate }: AlbumCardProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const isOwner = pubkey === album.pubkey;
  const isLocal = album.visibility === "local";
  const hasUpdate = useAppSelector(
    (s) => s.music.savedVersions[album.addressableId]?.hasUpdate ?? false,
  );

  const tracks = useAppSelector((s) => s.music.tracks);
  const tracksByAlbum = useAppSelector((s) => s.music.tracksByAlbum[album.addressableId]);
  const { playQueue } = useAudioPlayer();

  const [panelOpen, setPanelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handlePlayAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const refs = album.trackRefs.length > 0
      ? album.trackRefs
      : tracksByAlbum ?? [];
    const queueIds = refs.filter((id) => tracks[id]);
    if (queueIds.length > 0) playQueue(queueIds, 0);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (onNavigate) {
            onNavigate();
          } else {
            dispatch(
              setActiveDetailId({ view: "album-detail", id: album.addressableId }),
            );
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (onNavigate) {
              onNavigate();
            } else {
              dispatch(
                setActiveDetailId({ view: "album-detail", id: album.addressableId }),
              );
            }
          }
        }}
        className="group relative flex w-full cursor-pointer flex-col rounded-xl border border-border card-glass transition-all hover:border-border-light hover-lift"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-t-xl">
          {hasUpdate && (
            <div className="absolute left-2 top-2 z-10">
              <UpdateAvailableBadge />
            </div>
          )}
          {album.imageUrl ? (
            <img
              src={album.imageUrl}
              alt={album.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-card">
              <Disc3 size={32} className="text-muted" />
            </div>
          )}
          {/* Play All button */}
          <div
            role="button"
            tabIndex={0}
            onClick={handlePlayAll}
            onKeyDown={(e) => { if (e.key === "Enter") handlePlayAll(e as unknown as React.MouseEvent); }}
            className="absolute bottom-2 right-2 z-10 translate-y-2 scale-90 rounded-full bg-gradient-to-br from-primary to-primary-soft p-2 text-white opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 hover:scale-110 press-effect"
            title="Play All"
          >
            <Play size={16} fill="currentColor" className="ml-0.5" />
          </div>
        </div>
        {/* Three-dot menu button */}
        {(isOwner || !isLocal) && (
          <div className="absolute right-1 top-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPanelOpen(true);
              }}
              className="rounded-full bg-background/70 p-1 text-soft hover:text-heading"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        )}
        <div className="p-2">
          <p className="truncate text-sm font-medium text-heading">{album.title}</p>
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs text-soft">{album.artist}</p>
            {album.projectType !== "album" && (
              <span className="shrink-0 rounded bg-card-hover/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                {album.projectType}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Album Action Panel (full modal, like TrackActionPanel) */}
      <AlbumActionPanel
        album={album}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onEdit={() => setEditOpen(true)}
      />

      {editOpen && (
        <CreateAlbumModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          album={album}
        />
      )}
    </>
  );
});
