import {
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Volume2,
  Volume1,
  VolumeX,
  ListMusic,
  Heart,
  ChevronDown,
  Maximize2,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, useRef } from "react";
import { useAudioPlayer } from "../useAudioPlayer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setBarMode, toggleNowPlaying } from "@/store/slices/musicSlice";
import { openRightPanelToTab, toggleRightPanel } from "@/store/slices/uiSlice";
import { useLibrary } from "../useLibrary";
import { getTrackImage } from "../trackImage";
import { ProgressBar } from "./ProgressBar";
import { ListenTogetherBadge } from "@/features/listenTogether/ListenTogetherBadge";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ExpandedBar() {
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
  const queueVisible = useAppSelector((s) => {
    const rp = s.ui.rightPanel;
    const musicOpen =
      rp.openByContext.music && rp.activeTabByContext.music === "queue";
    const showingMusic =
      rp.contextOverride === "music" || s.ui.sidebarMode === "music";
    return musicOpen && showingMusic;
  });
  const ltActive = useAppSelector((s) => s.listenTogether.active);
  const ltIsFollower = useAppSelector(
    (s) => s.listenTogether.active && !s.listenTogether.isLocalDJ,
  );
  const { favoriteTrack, unfavoriteTrack, isTrackFavorited } = useLibrary();
  const isFavorited = currentTrack ? isTrackFavorited(currentTrack.addressableId) : false;

  const [showVolume, setShowVolume] = useState(false);
  const volumeTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (!currentTrack) return null;

  const imageUrl = getTrackImage(currentTrack, albums);

  const handleFavoriteToggle = () => {
    if (!currentTrack) return;
    if (isFavorited) {
      unfavoriteTrack(currentTrack.addressableId);
    } else {
      favoriteTrack(currentTrack.addressableId);
    }
  };

  const handleVolumeEnter = () => {
    clearTimeout(volumeTimeoutRef.current);
    setShowVolume(true);
  };

  const handleVolumeLeave = () => {
    volumeTimeoutRef.current = setTimeout(() => setShowVolume(false), 300);
  };

  const VolumeIcon = player.isMuted || player.volume === 0
    ? VolumeX
    : player.volume < 0.5
      ? Volume1
      : Volume2;

  return (
    <motion.div
      key="expanded"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
      className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 w-[680px] max-w-[calc(100vw-2rem)]"
    >
      <div className="glass-panel rounded-2xl shadow-[var(--shadow-elevated)] border border-primary/8 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* ── Left: Art + Info + Heart ── */}
          <div className="flex items-center gap-3 w-[180px] shrink-0">
            <button
              onClick={() => dispatch(toggleNowPlaying())}
              className="shrink-0 group relative"
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={currentTrack.title}
                  className="h-12 w-12 rounded-xl object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-card">
                  <ListMusic size={20} className="text-muted" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Maximize2 size={14} className="text-white" />
              </div>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-heading leading-tight">
                {currentTrack.title}
              </p>
              <p className="truncate text-xs text-soft leading-tight">
                {currentTrack.artist}
              </p>
            </div>
            <button
              onClick={handleFavoriteToggle}
              className="shrink-0 rounded p-1 text-soft transition-colors hover:text-heading"
            >
              <Heart
                size={15}
                className={isFavorited ? "fill-red-500 text-red-500" : ""}
              />
            </button>
            {ltActive && <ListenTogetherBadge />}
          </div>

          {/* ── Center: Transport + Progress ── */}
          <div className="flex flex-1 flex-col items-center gap-0.5 min-w-0">
            <div className={`flex items-center gap-3 ${ltIsFollower ? "opacity-50 pointer-events-none" : ""}`} title={ltIsFollower ? "DJ is controlling playback" : undefined}>
              <button
                onClick={toggleShuffle}
                className={`rounded p-1 transition-colors ${
                  player.shuffle ? "text-primary" : "text-soft hover:text-heading"
                }`}
              >
                <Shuffle size={14} />
              </button>
              <button
                onClick={prev}
                className="rounded p-1 text-soft transition-colors hover:text-heading"
              >
                <SkipBack size={16} />
              </button>
              <button
                onClick={togglePlay}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-soft text-white transition-transform hover:scale-105 press-effect"
              >
                {player.isPlaying ? (
                  <Pause size={14} fill="currentColor" />
                ) : (
                  <Play size={14} fill="currentColor" className="ml-0.5" />
                )}
              </button>
              <button
                onClick={next}
                className="rounded p-1 text-soft transition-colors hover:text-heading"
              >
                <SkipForward size={16} />
              </button>
              <button
                onClick={cycleRepeat}
                className={`rounded p-1 transition-colors ${
                  player.repeat !== "none" ? "text-primary" : "text-soft hover:text-heading"
                }`}
              >
                {player.repeat === "one" ? <Repeat1 size={14} /> : <Repeat size={14} />}
              </button>
            </div>

            <div className="flex w-full items-center gap-2">
              <span className="w-9 text-right text-[10px] text-muted tabular-nums">
                {formatTime(player.position)}
              </span>
              <ProgressBar
                position={player.position}
                duration={player.duration}
                onSeek={seek}
              />
              <span className="w-9 text-[10px] text-muted tabular-nums">
                {formatTime(player.duration)}
              </span>
            </div>
          </div>

          {/* ── Right: Volume, Queue, Minimize ── */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div
              className="relative"
              onMouseEnter={handleVolumeEnter}
              onMouseLeave={handleVolumeLeave}
            >
              <button
                onClick={toggleMute}
                className="rounded p-1 text-soft transition-colors hover:text-heading"
              >
                <VolumeIcon size={15} />
              </button>
              {showVolume && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 glass-panel rounded-lg px-2 py-3 shadow-lg">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={player.isMuted ? 0 : player.volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="h-20 w-1.5 cursor-pointer appearance-none rounded-full bg-surface-hover accent-primary
                      [writing-mode:vertical-lr] [direction:rtl]
                      [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-heading"
                  />
                </div>
              )}
            </div>
            <button
              onClick={() =>
                queueVisible
                  ? dispatch(toggleRightPanel("music"))
                  : dispatch(openRightPanelToTab({ context: "music", tab: "queue" }))
              }
              className={`rounded p-1 transition-colors ${
                queueVisible ? "text-primary" : "text-soft hover:text-heading"
              }`}
            >
              <ListMusic size={15} />
            </button>
            <button
              onClick={() => dispatch(setBarMode("mini"))}
              className="rounded p-1 text-soft transition-colors hover:text-heading"
            >
              <ChevronDown size={15} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
