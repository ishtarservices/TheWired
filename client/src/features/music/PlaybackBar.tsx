import {
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  ListMusic,
  Heart,
} from "lucide-react";
import { useAudioPlayer } from "./useAudioPlayer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { toggleQueuePanel } from "@/store/slices/musicSlice";
import { useLibrary } from "./useLibrary";
import { getTrackImage } from "./trackImage";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlaybackBar() {
  const dispatch = useAppDispatch();
  const {
    currentTrack,
    player,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
  } = useAudioPlayer();

  const albums = useAppSelector((s) => s.music.albums);
  const queueVisible = useAppSelector((s) => s.music.queueVisible);
  const { saveTrack, unsaveTrack, isTrackSaved } = useLibrary();
  const isSaved = currentTrack ? isTrackSaved(currentTrack.addressableId) : false;

  if (!currentTrack) return null;

  const imageUrl = getTrackImage(currentTrack, albums);

  const handleSaveToggle = () => {
    if (!currentTrack) return;
    if (isSaved) {
      unsaveTrack(currentTrack.addressableId);
    } else {
      saveTrack(currentTrack.addressableId);
    }
  };

  return (
    <div className="flex h-[76px] items-center border-t border-white/[0.04] glass px-5">
      {/* Left: Track info */}
      <div className="flex w-56 items-center gap-3 shrink-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={currentTrack.title}
            className="h-10 w-10 rounded object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded bg-card">
            <ListMusic size={18} className="text-muted" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-heading">
            {currentTrack.title}
          </p>
          <p className="truncate text-xs text-soft">{currentTrack.artist}</p>
        </div>
        <button
          onClick={handleSaveToggle}
          className="shrink-0 rounded p-1 text-soft transition-colors hover:text-heading"
        >
          <Heart
            size={16}
            className={isSaved ? "fill-red-500 text-red-500" : ""}
          />
        </button>
      </div>

      {/* Center: Transport + progress */}
      <div className="flex flex-1 flex-col items-center gap-1 px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleShuffle}
            className={`rounded p-1 transition-colors ${
              player.shuffle
                ? "text-neon"
                : "text-soft hover:text-heading"
            }`}
          >
            <Shuffle size={16} />
          </button>
          <button
            onClick={prev}
            className="rounded p-1 text-soft transition-colors hover:text-heading"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-pulse to-pulse-soft text-white transition-transform hover:scale-105 press-effect"
          >
            {player.isPlaying ? (
              <Pause size={16} fill="currentColor" />
            ) : (
              <Play size={16} fill="currentColor" className="ml-0.5" />
            )}
          </button>
          <button
            onClick={next}
            className="rounded p-1 text-soft transition-colors hover:text-heading"
          >
            <SkipForward size={18} />
          </button>
          <button
            onClick={cycleRepeat}
            className={`rounded p-1 transition-colors ${
              player.repeat !== "none"
                ? "text-neon"
                : "text-soft hover:text-heading"
            }`}
          >
            {player.repeat === "one" ? (
              <Repeat1 size={16} />
            ) : (
              <Repeat size={16} />
            )}
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex w-full max-w-lg items-center gap-2">
          <span className="w-10 text-right text-[11px] text-muted">
            {formatTime(player.position)}
          </span>
          <input
            type="range"
            min={0}
            max={player.duration || 0}
            step={0.1}
            value={player.position}
            onChange={(e) => seek(parseFloat(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/[0.06] accent-pulse
              [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-heading"
          />
          <span className="w-10 text-[11px] text-muted">
            {formatTime(player.duration)}
          </span>
        </div>
      </div>

      {/* Right: Volume + queue */}
      <div className="flex w-48 items-center justify-end gap-3 shrink-0">
        <button
          onClick={toggleMute}
          className="rounded p-1 text-soft transition-colors hover:text-heading"
        >
          {player.isMuted || player.volume === 0 ? (
            <VolumeX size={16} />
          ) : (
            <Volume2 size={16} />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.isMuted ? 0 : player.volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/[0.06] accent-pulse
            [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-heading"
        />
        <button
          onClick={() => dispatch(toggleQueuePanel())}
          className={`rounded p-1 transition-colors ${
            queueVisible
              ? "text-neon"
              : "text-soft hover:text-heading"
          }`}
        >
          <ListMusic size={16} />
        </button>
      </div>
    </div>
  );
}
