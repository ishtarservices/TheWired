import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Users,
  Music,
  Crown,
  X,
  LogOut,
} from "lucide-react";
import { useListenTogether } from "./useListenTogether";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { useAppSelector } from "@/store/hooks";
import { useProfile } from "@/features/profile/useProfile";
import { useResolvedArtist } from "@/features/music/useResolvedArtist";
import type { MusicTrack } from "@/types/music";

function ResolvedTrackArtist({ track }: { track: MusicTrack }) {
  const resolved = useResolvedArtist(track.artist, track.artistPubkeys);
  return <>{resolved}</>;
}
import { getTrackImage } from "@/features/music/trackImage";
import { ProgressBar } from "@/features/music/playbackBar/ProgressBar";
import { ReactionOverlay } from "./ReactionOverlay";

interface NowPlayingPanelProps {
  onClose: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const REACTION_EMOJIS = ["\uD83D\uDD25", "\u2764\uFE0F", "\uD83D\uDE0D", "\uD83D\uDE4C", "\uD83C\uDFB6", "\uD83D\uDCA5"];

/**
 * Expanded now-playing view inline in voice channel.
 * Shows album art, full track info, progress bar, transport controls (DJ only),
 * shared queue preview, and reactions.
 */
export function NowPlayingPanel({ onClose }: NowPlayingPanelProps) {
  const {
    active,
    isLocalDJ,
    djPubkey,
    listenerCount,
    reactions,
    react,
    voteSkip,
    skipVotes,
    leaveSession,
  } = useListenTogether();
  const { currentTrack, player, togglePlay, next, prev, seek } = useAudioPlayer();
  const albums = useAppSelector((s) => s.music.albums);
  const sharedQueue = useAppSelector((s) => s.listenTogether.sharedQueue);
  const sharedQueueIndex = useAppSelector((s) => s.listenTogether.sharedQueueIndex);
  const tracks = useAppSelector((s) => s.music.tracks);
  const { profile: djProfile } = useProfile(djPubkey ?? "");

  const resolvedArtist = useResolvedArtist(
    currentTrack?.artist ?? "",
    currentTrack?.artistPubkeys,
  );

  if (!active || !currentTrack) return null;

  const imageUrl = getTrackImage(currentTrack, albums);
  const djName = djProfile?.name ?? djProfile?.display_name ?? djPubkey?.slice(0, 8) ?? "DJ";

  // Next few tracks in queue
  const upcomingTracks = sharedQueue
    .slice(sharedQueueIndex + 1, sharedQueueIndex + 4)
    .map((id: string) => tracks[id])
    .filter(Boolean) as import("@/types/music").MusicTrack[];

  return (
    <div className="relative border-b border-border bg-field backdrop-blur-sm">
      <ReactionOverlay reactions={reactions} />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 z-10 rounded-full p-1 text-muted hover:text-heading hover:bg-card-hover transition-colors"
      >
        <X size={14} />
      </button>

      <div className="px-4 py-3">
        <div className="flex gap-4">
          {/* Album art */}
          <div className="shrink-0">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={currentTrack.title}
                className="h-20 w-20 rounded-xl object-cover shadow-lg"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-surface-hover">
                <Music size={28} className="text-muted" />
              </div>
            )}
          </div>

          {/* Track info + controls */}
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold text-heading">
              {currentTrack.title}
            </p>
            <p className="truncate text-xs text-soft mt-0.5">
              {resolvedArtist}
            </p>

            {/* DJ badge + listener count + leave */}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="flex items-center gap-1 text-[10px] text-primary">
                <Crown size={10} />
                {djName}
              </span>
              <span className="flex items-center gap-0.5 text-[10px] text-muted">
                <Users size={10} />
                {listenerCount} listening
              </span>
              {!isLocalDJ && (
                <button
                  onClick={leaveSession}
                  className="flex items-center gap-0.5 text-[10px] text-muted hover:text-red-400 transition-colors ml-auto"
                  title="Leave session"
                >
                  <LogOut size={10} />
                  Leave
                </button>
              )}
            </div>

            {/* Progress */}
            <div className="flex items-center gap-2 mt-2">
              <span className="w-8 text-right text-[10px] text-muted tabular-nums">
                {formatTime(player.position)}
              </span>
              <div className="flex-1">
                <ProgressBar
                  position={player.position}
                  duration={player.duration}
                  onSeek={isLocalDJ ? seek : () => {}}
                />
              </div>
              <span className="w-8 text-[10px] text-muted tabular-nums">
                {formatTime(player.duration)}
              </span>
            </div>

            {/* Transport controls */}
            <div className="flex items-center justify-center gap-3 mt-2">
              {isLocalDJ ? (
                <>
                  <button
                    onClick={prev}
                    className="rounded p-1 text-soft hover:text-heading transition-colors"
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    onClick={togglePlay}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-linear-to-br from-primary to-primary-soft text-white transition-transform hover:scale-105"
                  >
                    {player.isPlaying ? (
                      <Pause size={14} fill="currentColor" />
                    ) : (
                      <Play size={14} fill="currentColor" className="ml-0.5" />
                    )}
                  </button>
                  <button
                    onClick={next}
                    className="rounded p-1 text-soft hover:text-heading transition-colors"
                  >
                    <SkipForward size={16} />
                  </button>
                </>
              ) : (
                <button
                  onClick={voteSkip}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-soft hover:text-heading bg-surface hover:bg-surface-hover transition-colors"
                >
                  <SkipForward size={14} />
                  Vote Skip {skipVotes.length > 0 && `(${skipVotes.length}/${Math.ceil(listenerCount / 2)})`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Reaction bar */}
        <div className="flex items-center gap-1 mt-3">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => react(emoji)}
              className="rounded-full px-2 py-0.5 text-sm hover:bg-card-hover transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Up next */}
        {upcomingTracks.length > 0 && (
          <div className="mt-3 border-t border-border/30 pt-2">
            <p className="text-[10px] text-muted uppercase tracking-wider mb-1">Up Next</p>
            {upcomingTracks.map((track) => (
              <div key={track.addressableId} className="flex items-center gap-2 py-0.5">
                <span className="truncate text-xs text-soft flex-1">
                  {track.title}
                </span>
                <span className="truncate text-[10px] text-muted max-w-[100px]">
                  <ResolvedTrackArtist track={track} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
