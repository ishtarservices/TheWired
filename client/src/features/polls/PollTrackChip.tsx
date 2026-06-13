import { Play, Pause, Loader2, Music } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { useAudioPlayer } from "../music/useAudioPlayer";
import { useResolvedMusic } from "../music/useResolvedMusic";
import { getTrackImage } from "../music/trackImage";
import type { PollTrackRef } from "./pollParser";

interface PollTrackChipProps {
  trackRef: PollTrackRef;
  /** The option's plain-text label — shown until the track resolves */
  fallbackLabel: string;
}

/**
 * Mini embedded player inside a poll option: artwork with a play/pause
 * overlay + title/artist. Playback hands off to the global PlaybackBar.
 * Rendered inside a clickable option row, so the play control stops
 * propagation instead of nesting buttons.
 */
export function PollTrackChip({ trackRef, fallbackLabel }: PollTrackChipProps) {
  const { addressableId, track, resolving } = useResolvedMusic(
    trackRef.kind,
    trackRef.pubkey,
    trackRef.identifier,
  );
  const albums = useAppSelector((s) => s.music.albums);
  const { play, togglePlay, player } = useAudioPlayer();

  const isCurrent = player.currentTrackId === addressableId;
  const isPlaying = isCurrent && player.isPlaying;
  const image = track ? getTrackImage(track, albums) : undefined;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!track) return;
    if (isCurrent) {
      togglePlay();
    } else {
      play(addressableId);
    }
  };

  const PlayPauseIcon = isPlaying ? Pause : Play;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <button
        type="button"
        onClick={handlePlay}
        disabled={!track}
        className="group/track relative h-9 w-9 shrink-0 overflow-hidden rounded-md ring-1 ring-border"
        title={isPlaying ? "Pause" : "Play"}
      >
        {image ? (
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-card">
            <Music size={14} className="text-muted" />
          </span>
        )}
        <span
          className={`absolute inset-0 flex items-center justify-center transition-colors ${
            isPlaying ? "bg-black/50" : "bg-black/35 group-hover/track:bg-black/50"
          }`}
        >
          {resolving && !track ? (
            <Loader2 size={12} className="animate-spin text-white" />
          ) : (
            <PlayPauseIcon size={12} fill="white" className={`text-white ${isPlaying ? "" : "ml-0.5"}`} />
          )}
        </span>
      </button>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-medium ${
            isCurrent ? "text-primary" : "text-heading"
          }`}
        >
          {track?.title ?? fallbackLabel}
        </span>
        {track?.artist && (
          <span className="block truncate text-xs text-soft">{track.artist}</span>
        )}
      </span>
    </span>
  );
}
