import { memo, useState, useRef } from "react";
import { Play, MoreHorizontal, HardDriveDownload } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { useAudioPlayer } from "./useAudioPlayer";
import { EditTrackModal } from "./EditTrackModal";
import { FeaturedArtistsDisplay } from "./FeaturedArtistsDisplay";
import { TrackActionMenu } from "./TrackActionMenu";
import { publishExisting } from "@/lib/nostr/publish";
import { getEvent } from "@/lib/db/eventStore";
import { removeLocalEventId } from "@/lib/db/musicStore";

interface TrackRowProps {
  track: MusicTrack;
  index: number;
  queueTracks?: string[];
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
}: TrackRowProps) {
  const dispatch = useAppDispatch();
  const { playQueue, play, togglePlay, player } = useAudioPlayer();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const albumName = useAppSelector((s) =>
    track.albumRef ? s.music.albums[track.albumRef]?.title : undefined,
  );
  const isDownloaded = useAppSelector((s) =>
    s.music.downloadedTrackIds.includes(track.addressableId),
  );
  const isOwner = pubkey === track.pubkey;
  const isLocal = track.visibility === "local";
  const isCurrent = player.currentTrackId === track.addressableId;
  const isPlaying = isCurrent && player.isPlaying;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const handlePlay = () => {
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

  return (
    <div
      onClick={handlePlay}
      className={`group grid cursor-pointer grid-cols-[2rem_1fr_1fr_4rem_2rem] items-center gap-4 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-surface ${
        isCurrent ? "text-neon" : "text-soft"
      }`}
    >
      {/* Index / play icon */}
      <div className="flex items-center justify-center">
        {isPlaying ? (
          <div className="flex items-center gap-0.5">
            <span className="block h-2.5 w-0.5 animate-pulse bg-neon" />
            <span className="block h-2.5 w-0.5 animate-pulse bg-neon delay-75" />
          </div>
        ) : (
          <>
            <span className="group-hover:hidden">{index + 1}</span>
            <Play
              size={14}
              fill="currentColor"
              className="hidden group-hover:block"
            />
          </>
        )}
      </div>

      {/* Title + artist */}
      <div className="min-w-0">
        <p className={`truncate text-sm ${isCurrent ? "text-neon" : "text-heading"}`}>
          {track.title}
          {isLocal && (
            <span className="ml-1.5 inline-block rounded bg-card px-1 py-0.5 text-[10px] text-muted">
              LOCAL
            </span>
          )}
          {isDownloaded && (
            <span title="Available offline" className="ml-1.5 inline-block align-middle">
              <HardDriveDownload size={12} className="text-pulse/70" />
            </span>
          )}
        </p>
        <p className="truncate text-xs text-soft">
          {track.artist}
          <FeaturedArtistsDisplay pubkeys={track.featuredArtists} />
          {albumName && (
            <>
              {" "}
              <span className="text-muted">&middot;</span>{" "}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch(setActiveDetailId({ view: "album-detail", id: track.albumRef! }));
                }}
                className="cursor-pointer text-muted hover:text-heading hover:underline"
              >
                {albumName}
              </button>
            </>
          )}
        </p>
      </div>

      {/* Genre + hashtags */}
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {track.genre && (
          <span className="shrink-0 text-xs text-muted">{track.genre}</span>
        )}
        {track.hashtags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="shrink-0 rounded-full bg-card px-1.5 py-0.5 text-[10px] text-muted"
          >
            #{tag}
          </span>
        ))}
      </div>

      {/* Duration */}
      <span className="text-right text-xs text-muted">
        {formatDuration(track.duration)}
      </span>

      {/* Action menu */}
      <div className="relative flex items-center justify-center">
        {(isOwner || !isLocal) && (
          <>
            <button
              ref={menuBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted hover:text-heading transition-opacity"
            >
              <MoreHorizontal size={16} />
            </button>
            <TrackActionMenu
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
  );
});
