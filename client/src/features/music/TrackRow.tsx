import { memo, useState } from "react";
import { Play, MoreHorizontal, Pencil, Upload, Link2, Heart } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector } from "@/store/hooks";
import { useAudioPlayer } from "./useAudioPlayer";
import { useLibrary } from "./useLibrary";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { EditTrackModal } from "./EditTrackModal";
import { FeaturedArtistsDisplay } from "./FeaturedArtistsDisplay";
import { publishExisting } from "@/lib/nostr/publish";
import { getEvent } from "@/lib/db/eventStore";
import { removeLocalEventId } from "@/lib/db/musicStore";
import { buildMusicLink } from "./musicLinks";
import { copyToClipboard } from "@/lib/clipboard";

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
  const { playQueue, play, togglePlay, player } = useAudioPlayer();
  const { saveTrack, unsaveTrack, isTrackSaved } = useLibrary();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const isOwner = pubkey === track.pubkey;
  const isLocal = track.visibility === "local";
  const saved = !isLocal && isTrackSaved(track.addressableId);
  const isCurrent = player.currentTrackId === track.addressableId;
  const isPlaying = isCurrent && player.isPlaying;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

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
      className={`group grid cursor-pointer grid-cols-[2rem_1fr_1fr_4rem_2rem] items-center gap-4 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-card-hover/30 ${
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
        </p>
        <p className="truncate text-xs text-soft">
          {track.artist}
          <FeaturedArtistsDisplay pubkeys={track.featuredArtists} />
        </p>
      </div>

      {/* Genre */}
      <span className="truncate text-xs text-muted">{track.genre ?? ""}</span>

      {/* Duration */}
      <span className="text-right text-xs text-muted">
        {formatDuration(track.duration)}
      </span>

      {/* Action menu */}
      <div className="relative flex items-center justify-center">
        {(isOwner || !isLocal) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="opacity-0 group-hover:opacity-100 text-muted hover:text-heading transition-opacity"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
        {menuOpen && (
          <PopoverMenu open={menuOpen} onClose={() => setMenuOpen(false)} position="below">
            {!isOwner && !isLocal && (
              <PopoverMenuItem
                icon={<Heart size={14} className={saved ? "fill-red-500 text-red-500" : ""} />}
                label={saved ? "Remove from Library" : "Add to Library"}
                onClick={() => {
                  setMenuOpen(false);
                  if (saved) unsaveTrack(track.addressableId);
                  else saveTrack(track.addressableId);
                }}
              />
            )}
            {!isLocal && (
              <PopoverMenuItem
                icon={<Link2 size={14} />}
                label="Copy Link"
                onClick={() => {
                  setMenuOpen(false);
                  copyToClipboard(buildMusicLink(track.addressableId));
                }}
              />
            )}
            {isOwner && (
              <>
                {!isLocal && <PopoverMenuSeparator />}
                <PopoverMenuItem
                  icon={<Pencil size={14} />}
                  label="Edit Track"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditOpen(true);
                  }}
                />
                {isLocal && (
                  <PopoverMenuItem
                    icon={<Upload size={14} />}
                    label={publishing ? "Publishing..." : "Publish to Relays"}
                    onClick={handlePublish}
                  />
                )}
              </>
            )}
          </PopoverMenu>
        )}
      </div>

      {editOpen && (
        <EditTrackModal track={track} onClose={() => setEditOpen(false)} />
      )}
    </div>
  );
});
