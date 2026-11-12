import { memo, useState, useRef } from "react";
import { Play, Pause, MoreHorizontal, HardDriveDownload, Lock } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useHoldsProjectKey, useIsMine } from "./sharedKey/ownership";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { useAudioPlayer } from "./useAudioPlayer";
import { EditTrackModal } from "./EditTrackModal";
import { FeaturedArtistsDisplay } from "./FeaturedArtistsDisplay";
import { TrackActionPanel } from "./TrackActionPanel";
import { RequestAccessButton } from "./RequestAccessButton";
import { useResolvedArtist, resolveArtistDetailTarget } from "./useResolvedArtist";
import { publishExisting } from "@/lib/nostr/publish";
import { getEvent } from "@/lib/db/eventStore";
import { removeLocalEventId } from "@/lib/db/musicStore";
import { UpdateAvailableBadge } from "./UpdateAvailableBadge";
import { useHasPendingUpdate } from "./useSavedVersions";
import { acknowledgeUpdate } from "./savedVersionSync";

interface TrackRowProps {
  track: MusicTrack;
  index: number;
  queueTracks?: string[];
  onAlbumClick?: (albumId: string) => void;
  /** Optional 1-based number to render in the # column. Falls back to `index + 1`. */
  displayIndex?: number;
  /**
   * Where the row sits. Inside a project ("album") the artist and project are
   * already on screen, so the row is a single line: number, title, duration.
   * Everywhere else ("list") it carries artist · project and the genre.
   */
  context?: "list" | "album";
}

function formatDuration(seconds?: number): string {
  if (!seconds || !isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  queueTracks,
  onAlbumClick,
  displayIndex,
  context = "list",
}: TrackRowProps) {
  const dispatch = useAppDispatch();
  const { playQueue, play, togglePlay, player } = useAudioPlayer();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const isMine = useIsMine();
  const albumName = useAppSelector((s) =>
    track.albumRef ? s.music.albums[track.albumRef]?.title : undefined,
  );
  const isDownloaded = useAppSelector((s) =>
    s.music.downloadedTrackIds.includes(track.addressableId),
  );
  const resolvedArtist = useResolvedArtist(track.artist, track.artistPubkeys);
  const isOwner = isMine(track.pubkey);
  const holdsKey = useHoldsProjectKey(track.pubkey);
  const hasUpdate = useHasPendingUpdate(track.addressableId);
  const isLocal = track.visibility === "local";
  // A private track the viewer isn't the owner/collaborator/artist for — its media is
  // server-gated, so mark the row and gate play rather than firing a silent 404.
  const locked =
    track.visibility === "private" &&
    !isOwner &&
    !track.collaborators.includes(pubkey ?? "") &&
    !track.artistPubkeys.includes(pubkey ?? "") &&
    !track.featuredArtists.includes(pubkey ?? "");
  const hasError = player.playbackError?.trackId === track.addressableId;
  const isCurrent = player.currentTrackId === track.addressableId;
  const isPlaying = isCurrent && player.isPlaying;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const handlePlay = () => {
    // Private track the viewer can't access — don't attempt playback (would 404).
    if (locked) return;
    // Playing a saved track that has a newer version counts as seeing the update.
    if (hasUpdate) void acknowledgeUpdate(track.addressableId);
    // If this track is already current, toggle play/pause instead of restarting
    if (isCurrent) {
      togglePlay();
      return;
    }
    if (queueTracks) {
      playQueue(queueTracks, index);
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

  const inAlbum = context === "album";
  const badge = "ml-2 inline-block rounded-sm border border-border px-1 py-px align-middle font-mono text-[9px] uppercase leading-none tracking-wider text-muted";

  return (
    <div>
      <div
        onClick={handlePlay}
        className={`group flex cursor-pointer items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-surface ${
          inAlbum ? "h-10" : "py-1.5"
        } ${isCurrent ? "bg-surface" : ""}`}
      >
        {/* Index / play icon */}
        <div className="readout flex w-6 shrink-0 items-center justify-center text-xs text-muted">
          {locked ? (
            <Lock size={12} className="text-muted" />
          ) : isCurrent ? (
            <>
              <span
                className={`eq-bars text-primary ${isPlaying ? "group-hover:hidden" : ""}`}
                data-paused={!isPlaying}
                aria-label={isPlaying ? "Playing" : "Paused"}
              >
                <span />
                <span />
                <span />
              </span>
              {isPlaying && (
                <Pause size={13} fill="currentColor" className="hidden text-heading group-hover:block" />
              )}
            </>
          ) : (
            <>
              <span className="group-hover:hidden">{displayIndex ?? index + 1}</span>
              <Play
                size={13}
                fill="currentColor"
                className="hidden text-heading group-hover:block"
              />
            </>
          )}
        </div>

        {/* Title + artist */}
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[13px] ${isCurrent ? "text-primary" : "text-heading"}`}>
            {track.title}
            {inAlbum && <FeaturedArtistsDisplay pubkeys={track.featuredArtists} />}
            {isLocal && <span className={badge}>Local</span>}
            {holdsKey && (
              <span
                title="A shared project you co-own: signed by its own key"
                className={badge}
              >
                Shared
              </span>
            )}
            {isOwner && track.inCatalog === false && (
              <span
                title="Not in your catalog — public and playable where it's embedded, but hidden from your profile, library and browse"
                className={badge}
              >
                Unlisted
              </span>
            )}
            {hasUpdate && (
              <UpdateAvailableBadge
                title="New version available — play to update"
                className="ml-2 align-middle"
              />
            )}
            {isDownloaded && (
              <span title="Available offline" className="ml-2 inline-block align-middle">
                <HardDriveDownload size={12} className="text-primary/70" />
              </span>
            )}
            {locked && (
              <span title="Private — you don't have access" className={badge}>
                Private
              </span>
            )}
            {locked && <RequestAccessButton targetRef={track.addressableId} className="ml-2" />}
            {hasError && !locked && (
              <span className={`${badge} border-red-500/30 text-red-400`}>Unavailable</span>
            )}
          </p>
          {!inAlbum && (
            <p className="truncate text-xs text-muted">
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
                    className="cursor-pointer hover:text-heading hover:underline"
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onAlbumClick) {
                        onAlbumClick(track.albumRef!);
                      } else {
                        dispatch(setActiveDetailId({ view: "album-detail", id: track.albumRef! }));
                      }
                    }}
                    className="cursor-pointer hover:text-heading hover:underline"
                  >
                    {albumName}
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        {/* Genre: only in flat lists, and only when there's room */}
        {!inAlbum && track.genre && (
          <span className="hidden w-40 shrink-0 truncate text-xs text-muted lg:block">
            {track.genre}
          </span>
        )}

        {/* Duration */}
        <span className="readout w-10 shrink-0 text-right text-xs text-muted">
          {formatDuration(track.duration)}
        </span>

        {/* Action menu */}
        <div className="relative flex w-6 shrink-0 items-center justify-center">
          {(isOwner || !isLocal) && (
            <>
              <button
                ref={menuBtnRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-heading focus-visible:opacity-100 group-hover:opacity-100"
              >
                <MoreHorizontal size={16} />
              </button>
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
            </>
          )}
        </div>

        {editOpen && (
          <EditTrackModal track={track} onClose={() => setEditOpen(false)} />
        )}
      </div>
    </div>
  );
});
