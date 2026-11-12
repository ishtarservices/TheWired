import { memo, useState } from "react";
import { MoreHorizontal, Play } from "lucide-react";
import type { MusicAlbum } from "@/types/music";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useHoldsProjectKey, useIsMine } from "./sharedKey/ownership";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { CreateAlbumModal } from "./CreateAlbumModal";
import { AlbumActionPanel } from "./AlbumActionPanel";
import { useAudioPlayer } from "./useAudioPlayer";
import { UpdateAvailableBadge } from "./UpdateAvailableBadge";
import { useHasPendingUpdate } from "./useSavedVersions";
import { useResolvedArtist, resolveArtistDetailTarget } from "./useResolvedArtist";
import { Artwork } from "./Artwork";

interface AlbumCardProps {
  album: MusicAlbum;
  onNavigate?: () => void;
}

export const AlbumCard = memo(function AlbumCard({ album, onNavigate }: AlbumCardProps) {
  const dispatch = useAppDispatch();
  const isMine = useIsMine();
  const resolvedArtist = useResolvedArtist(album.artist, album.artistPubkeys);
  const isOwner = isMine(album.pubkey);
  const holdsKey = useHoldsProjectKey(album.pubkey);
  const isLocal = album.visibility === "local";
  const hasUpdate = useHasPendingUpdate(album.addressableId);

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
        className="group relative flex w-full cursor-pointer flex-col rounded-lg text-left outline-offset-4"
      >
        <div className="relative">
          <Artwork
            src={album.imageUrl}
            title={album.title}
            className="aspect-square w-full rounded-lg shadow-[var(--shadow-sm)] transition-[filter,box-shadow] duration-200 group-hover:shadow-[var(--shadow-lg)] group-hover:brightness-90"
          />
          {hasUpdate && (
            <div className="absolute left-2 top-2 z-10">
              <UpdateAvailableBadge />
            </div>
          )}
          {/* Play All button */}
          <div
            role="button"
            tabIndex={0}
            onClick={handlePlayAll}
            onKeyDown={(e) => { if (e.key === "Enter") handlePlayAll(e as unknown as React.MouseEvent); }}
            className="absolute bottom-2 right-2 z-10 flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-heading text-background opacity-0 shadow-[var(--shadow-md)] transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 press-effect"
            title="Play All"
          >
            <Play size={15} fill="currentColor" className="ml-0.5" />
          </div>
          {/* Three-dot menu button */}
          {(isOwner || !isLocal) && (
            <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPanelOpen(true);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm hover:text-white"
                aria-label="Project actions"
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
          )}
        </div>
        <div className="px-0.5 pt-2.5">
          <p className="truncate text-[13px] font-medium text-heading">{album.title}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            {(() => {
              const target = resolveArtistDetailTarget(album.artist, album.artistPubkeys);
              if (!target) {
                return <p className="truncate text-xs text-muted">{resolvedArtist}</p>;
              }
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(setActiveDetailId(target));
                  }}
                  className="truncate text-xs text-muted hover:text-heading hover:underline"
                >
                  {resolvedArtist}
                </button>
              );
            })()}
            {album.projectType !== "album" && (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-faint">
                {album.projectType}
              </span>
            )}
            {holdsKey && (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-faint">shared</span>
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
