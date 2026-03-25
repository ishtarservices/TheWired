import { Play, Pause, SkipForward, Users, Music, LogOut } from "lucide-react";
import { useListenTogether } from "./useListenTogether";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { useAppSelector } from "@/store/hooks";
import { useProfile } from "@/features/profile/useProfile";
import { getTrackImage } from "@/features/music/trackImage";

interface NowPlayingStripProps {
  onExpand?: () => void;
}

/**
 * Compact now-playing bar shown in voice channel header when Listen Together is active.
 * Shows album art, track info, DJ badge, and transport or vote-skip controls.
 */
export function NowPlayingStrip({ onExpand }: NowPlayingStripProps) {
  const { active, isLocalDJ, djPubkey, listenerCount, voteSkip, leaveSession } = useListenTogether();
  const { currentTrack, player, togglePlay } = useAudioPlayer();
  const albums = useAppSelector((s) => s.music.albums);
  const { profile: djProfile } = useProfile(djPubkey ?? "");

  if (!active || !currentTrack) return null;

  const imageUrl = getTrackImage(currentTrack, albums);
  const djName = djProfile?.name ?? djProfile?.display_name ?? djPubkey?.slice(0, 8) ?? "DJ";

  return (
    <button
      onClick={onExpand}
      className="flex items-center gap-2.5 w-full px-3 py-1.5 bg-primary/5 border-b border-primary/10 hover:bg-primary/8 transition-colors text-left"
    >
      {/* Album art */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={currentTrack.title}
          className="h-6 w-6 rounded object-cover shrink-0"
        />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded bg-surface-hover shrink-0">
          <Music size={12} className="text-muted" />
        </div>
      )}

      {/* Track info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-heading leading-tight">
          {currentTrack.title}
        </p>
        <p className="truncate text-[10px] text-soft leading-tight">
          {currentTrack.artist}
        </p>
      </div>

      {/* DJ badge */}
      <span className="shrink-0 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
        DJ: {djName}
      </span>

      {/* Transport or vote-skip */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        {isLocalDJ ? (
          <button
            onClick={togglePlay}
            className="rounded-full p-1 text-heading hover:bg-card-hover transition-colors"
            title={player.isPlaying ? "Pause" : "Play"}
          >
            {player.isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
        ) : (
          <>
            <button
              onClick={voteSkip}
              className="rounded-full p-1 text-soft hover:text-heading hover:bg-card-hover transition-colors"
              title="Vote to skip"
            >
              <SkipForward size={14} />
            </button>
            <button
              onClick={leaveSession}
              className="rounded-full p-1 text-soft hover:text-red-400 hover:bg-card-hover transition-colors"
              title="Leave session"
            >
              <LogOut size={14} />
            </button>
          </>
        )}
      </div>

      {/* Listener count */}
      <span className="flex items-center gap-0.5 text-[10px] text-muted shrink-0">
        <Users size={10} />
        {listenerCount}
      </span>
    </button>
  );
}
