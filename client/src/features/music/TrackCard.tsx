import { memo, useState, useRef } from "react";
import { Play, Heart, Plus, Check, MoreHorizontal, HardDriveDownload } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { useAudioPlayer } from "./useAudioPlayer";
import { useLibrary } from "./useLibrary";
import { FeaturedArtistsDisplay } from "./FeaturedArtistsDisplay";
import { TrackActionPanel } from "./TrackActionPanel";
import { EditTrackModal } from "./EditTrackModal";
import { getTrackImage } from "./trackImage";
import { publishExisting } from "@/lib/nostr/publish";
import { getEvent } from "@/lib/db/eventStore";
import { removeLocalEventId } from "@/lib/db/musicStore";

interface TrackCardProps {
  track: MusicTrack;
  queueTracks?: string[];
  queueIndex?: number;
}

export const TrackCard = memo(function TrackCard({
  track,
  queueTracks,
  queueIndex,
}: TrackCardProps) {
  const dispatch = useAppDispatch();
  const { playQueue, play, pause, resume, player } = useAudioPlayer();
  const albums = useAppSelector((s) => s.music.albums);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { saveTrack, unsaveTrack, isTrackSaved, favoriteTrack, unfavoriteTrack, isTrackFavorited } = useLibrary();
  const isPlaying = player.currentTrackId === track.addressableId && player.isPlaying;
  const imageUrl = getTrackImage(track, albums);
  const isOwner = pubkey === track.pubkey;
  const isLocal = track.visibility === "local";
  const saved = isTrackSaved(track.addressableId);
  const favorited = isTrackFavorited(track.addressableId);
  const albumName = track.albumRef ? albums[track.albumRef]?.title : undefined;
  const isDownloaded = useAppSelector((s) =>
    s.music.downloadedTrackIds.includes(track.addressableId),
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    if (isPlaying) {
      pause();
    } else if (player.currentTrackId === track.addressableId) {
      resume();
    } else if (queueTracks && queueIndex !== undefined) {
      playQueue(queueTracks, queueIndex);
    } else {
      play(track.addressableId);
    }
  };

  const handlePublish = async () => {
    setMenuOpen(false);
    setPublishing(true);
    try {
      const event = await getEvent(track.eventId);
      if (event) {
        await publishExisting(event);
        await removeLocalEventId(event.id);
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
        className="group flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-edge card-glass transition-all hover:border-edge-light hover-lift"
      >
        <div className="relative aspect-square w-full">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={track.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-card">
              <Play size={32} className="text-muted" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
            <div className="scale-0 rounded-full bg-gradient-to-br from-pulse to-pulse-soft p-2.5 text-white transition-transform group-hover:scale-100">
              {isPlaying ? (
                <div className="flex items-center gap-0.5">
                  <span className="block h-3 w-0.5 animate-pulse bg-backdrop" />
                  <span className="block h-3 w-0.5 animate-pulse bg-backdrop delay-75" />
                  <span className="block h-3 w-0.5 animate-pulse bg-backdrop delay-150" />
                </div>
              ) : (
                <Play size={18} fill="currentColor" className="ml-0.5" />
              )}
            </div>
          </div>
          {track.visibility === "local" && (
            <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
              LOCAL
            </span>
          )}
          {isDownloaded && (
            <span className="absolute left-1.5 bottom-1.5 rounded bg-black/60 p-1" title="Available offline">
              <HardDriveDownload size={12} className="text-pulse/90" />
            </span>
          )}
          {/* Library + Favorite buttons */}
          {!isOwner && !isLocal && (
            <div className="absolute right-1.5 top-1.5 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (saved) unsaveTrack(track.addressableId);
                  else saveTrack(track.addressableId);
                }}
                className="rounded-full bg-backdrop/70 p-1 text-soft hover:text-heading"
                title={saved ? "Remove from Library" : "Add to Library"}
              >
                {saved ? <Check size={14} className="text-green-400" /> : <Plus size={14} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (favorited) unfavoriteTrack(track.addressableId);
                  else favoriteTrack(track.addressableId);
                }}
                className="rounded-full bg-backdrop/70 p-1 text-soft hover:text-heading"
                title={favorited ? "Remove from Favorites" : "Add to Favorites"}
              >
                <Heart
                  size={14}
                  className={favorited ? "fill-red-500 text-red-500" : ""}
                />
              </button>
            </div>
          )}
          {/* Three-dot menu button */}
          {(isOwner || !isLocal) && (
            <button
              ref={menuBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="absolute bottom-1.5 right-1.5 rounded-full bg-backdrop/70 p-1 text-soft opacity-0 transition-opacity hover:text-heading group-hover:opacity-100"
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>
        <div className="p-2 text-left">
          <p className="truncate text-sm font-medium text-heading">{track.title}</p>
          <p className="truncate text-xs text-soft">
            {track.artist}
            <FeaturedArtistsDisplay pubkeys={track.featuredArtists} />
          </p>
          {albumName && (
            <p
              className="truncate text-[11px] text-muted hover:text-heading hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                dispatch(setActiveDetailId({ view: "album-detail", id: track.albumRef! }));
              }}
            >
              {albumName}
            </p>
          )}
        </div>
      </div>

      <TrackActionPanel
        track={track}
        isOwner={isOwner}
        isLocal={isLocal}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onEdit={() => setEditOpen(true)}
        onPublish={handlePublish}
        publishing={publishing}
        anchorRef={menuBtnRef}
      />

      {editOpen && (
        <EditTrackModal track={track} onClose={() => setEditOpen(false)} />
      )}
    </>
  );
});
