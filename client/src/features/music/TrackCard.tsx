import { memo, useState, useRef } from "react";
import { Play, Heart, Plus, Check, MoreHorizontal, HardDriveDownload } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useIsMine } from "./sharedKey/ownership";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { useAudioPlayer } from "./useAudioPlayer";
import { useLibrary } from "./useLibrary";
import { FeaturedArtistsDisplay } from "./FeaturedArtistsDisplay";
import { TrackActionPanel } from "./TrackActionPanel";
import { EditTrackModal } from "./EditTrackModal";
import { getTrackImage } from "./trackImage";
import { useResolvedArtist, resolveArtistDetailTarget } from "./useResolvedArtist";
import { Artwork } from "./Artwork";
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
  const isMine = useIsMine();
  const { saveTrack, unsaveTrack, isTrackSaved, favoriteTrack, unfavoriteTrack, isTrackFavorited } = useLibrary();
  const isPlaying = player.currentTrackId === track.addressableId && player.isPlaying;
  const imageUrl = getTrackImage(track, albums);
  const resolvedArtist = useResolvedArtist(track.artist, track.artistPubkeys);
  const isOwner = isMine(track.pubkey);
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
        className="group flex w-full cursor-pointer flex-col rounded-lg text-left outline-offset-4"
      >
        <div className="relative">
          <Artwork
            src={imageUrl}
            title={track.title}
            className="aspect-square w-full rounded-lg shadow-[var(--shadow-sm)] transition-[filter,box-shadow] duration-200 group-hover:shadow-[var(--shadow-lg)] group-hover:brightness-90"
          />
          {/* Play / now-playing */}
          <div
            className={`absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-heading text-background shadow-[var(--shadow-md)] transition-all duration-200 ease-out ${
              isPlaying ? "opacity-100" : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100"
            }`}
          >
            {isPlaying ? (
              <span className="eq-bars" aria-label="Playing">
                <span />
                <span />
                <span />
              </span>
            ) : (
              <Play size={15} fill="currentColor" className="ml-0.5" />
            )}
          </div>
          {track.visibility === "local" && (
            <span className="absolute left-2 top-2 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/85 backdrop-blur-sm">
              Local
            </span>
          )}
          {isDownloaded && (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/60 p-1 backdrop-blur-sm" title="Available offline">
              <HardDriveDownload size={12} className="text-white/90" />
            </span>
          )}
          {/* Library + Favorite + menu */}
          <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {!isOwner && !isLocal && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (saved) unsaveTrack(track.addressableId);
                    else saveTrack(track.addressableId);
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm hover:text-white"
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
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm hover:text-white"
                  title={favorited ? "Remove from Favorites" : "Add to Favorites"}
                >
                  <Heart
                    size={14}
                    className={favorited ? "fill-red-500 text-red-500" : ""}
                  />
                </button>
              </>
            )}
            {(isOwner || !isLocal) && (
              <button
                ref={menuBtnRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm hover:text-white"
                aria-label="Track actions"
              >
                <MoreHorizontal size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="px-0.5 pt-2.5 text-left">
          <p className="truncate text-[13px] font-medium text-heading">{track.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {(() => {
              const target = resolveArtistDetailTarget(track.artist, track.artistPubkeys);
              if (!target) return <span>{resolvedArtist}</span>;
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(setActiveDetailId(target));
                  }}
                  className="hover:text-heading hover:underline"
                >
                  {resolvedArtist}
                </button>
              );
            })()}
            <FeaturedArtistsDisplay pubkeys={track.featuredArtists} />
            {albumName && (
              <>
                {" "}
                <span className="text-faint">&middot;</span>{" "}
                <span
                  className="hover:text-heading hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(setActiveDetailId({ view: "album-detail", id: track.albumRef! }));
                  }}
                >
                  {albumName}
                </span>
              </>
            )}
          </p>
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
