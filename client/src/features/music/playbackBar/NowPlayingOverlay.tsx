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
  X,
  GripVertical,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useAudioPlayer } from "../useAudioPlayer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  toggleNowPlaying,
  setCurrentTrack,
  removeFromQueue,
  reorderQueue,
} from "@/store/slices/musicSlice";
import { openRightPanelToTab } from "@/store/slices/uiSlice";
import { useLibrary } from "../useLibrary";
import { getTrackImage } from "../trackImage";
import { useWaveform } from "../panel/useWaveform";
import { selectAudioSource } from "../trackParser";
import { ProgressBar } from "./ProgressBar";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function NowPlayingOverlay() {
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
  const tracks = useAppSelector((s) => s.music.tracks);
  const { favoriteTrack, unfavoriteTrack, isTrackFavorited } = useLibrary();
  const isFavorited = currentTrack ? isTrackFavorited(currentTrack.addressableId) : false;

  const audioUrl = currentTrack ? selectAudioSource(currentTrack.variants) : null;
  const { canvasRef } = useWaveform(audioUrl, true, (fraction) => {
    if (player.duration > 0) seek(fraction * player.duration);
  });

  // ── Drag-to-reorder state (same pattern as QueuePanel) ──
  const [dragging, setDragging] = useState<{ fromIdx: number } | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const itemRects = useRef<DOMRect[]>([]);

  const captureRects = useCallback(() => {
    if (!queueListRef.current) return;
    const items = queueListRef.current.querySelectorAll("[data-queue-item]");
    itemRects.current = Array.from(items).map((el) => el.getBoundingClientRect());
  }, []);

  const getDropIndex = useCallback((clientY: number): number => {
    const rects = itemRects.current;
    for (let i = 0; i < rects.length; i++) {
      const mid = rects[i].top + rects[i].height / 2;
      if (clientY < mid) return i;
    }
    return rects.length - 1;
  }, []);

  const handleGripMouseDown = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.preventDefault();
      e.stopPropagation();
      captureRects();
      setDragging({ fromIdx: idx });
      setDropIdx(idx);
    },
    [captureRects],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const target = getDropIndex(e.clientY);
      setDropIdx(target);

      // Auto-scroll the queue container near edges
      const container = queueListRef.current?.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        const edgeZone = 40;
        if (e.clientY < rect.top + edgeZone) {
          container.scrollTop -= 8;
        } else if (e.clientY > rect.bottom - edgeZone) {
          container.scrollTop += 8;
        }
      }
    };

    const onMouseUp = () => {
      if (dragging && dropIdx !== null && dragging.fromIdx !== dropIdx) {
        dispatch(reorderQueue({ from: dragging.fromIdx, to: dropIdx }));
      }
      setDragging(null);
      setDropIdx(null);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, dropIdx, dispatch, getDropIndex]);

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

  const VolumeIcon = player.isMuted || player.volume === 0
    ? VolumeX
    : player.volume < 0.5
      ? Volume1
      : Volume2;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col"
      onClick={() => dispatch(toggleNowPlaying())}
    >
      {/* Backdrop with blurred album art */}
      <div className="absolute inset-0 overflow-hidden">
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover scale-110 blur-[80px] opacity-30"
          />
        )}
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
      </div>

      {/* Scrollable content */}
      <div
        className="relative z-10 flex-1 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
          <div className="flex w-full max-w-md flex-col items-center gap-5">
            {/* Close button */}
            <button
              onClick={() => dispatch(toggleNowPlaying())}
              className="absolute top-4 right-6 rounded-full p-2 text-soft transition-colors hover:text-heading hover:bg-white/10"
            >
              <X size={20} />
            </button>

            {/* Album art */}
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={currentTrack.title}
                className="h-[240px] w-[240px] sm:h-[280px] sm:w-[280px] rounded-2xl object-cover shadow-2xl shrink-0"
              />
            ) : (
              <div className="flex h-[240px] w-[240px] sm:h-[280px] sm:w-[280px] items-center justify-center rounded-2xl bg-card shadow-2xl shrink-0">
                <ListMusic size={64} className="text-muted" />
              </div>
            )}

            {/* Title + Artist + Heart */}
            <div className="flex w-full items-center gap-3">
              <div className="min-w-0 flex-1 text-center">
                <p className="truncate text-lg font-semibold text-heading">
                  {currentTrack.title}
                </p>
                <p className="truncate text-sm text-soft">
                  {currentTrack.artist}
                </p>
              </div>
              <button
                onClick={handleFavoriteToggle}
                className="shrink-0 rounded p-1.5 text-soft transition-colors hover:text-heading"
              >
                <Heart
                  size={20}
                  className={isFavorited ? "fill-red-500 text-red-500" : ""}
                />
              </button>
            </div>

            {/* Waveform */}
            <canvas
              ref={canvasRef}
              className="h-14 w-full cursor-pointer rounded-lg shrink-0"
            />

            {/* Progress times */}
            <div className="flex w-full items-center gap-3">
              <span className="text-xs text-muted tabular-nums">
                {formatTime(player.position)}
              </span>
              <ProgressBar
                position={player.position}
                duration={player.duration}
                onSeek={seek}
              />
              <span className="text-xs text-muted tabular-nums">
                {formatTime(player.duration)}
              </span>
            </div>

            {/* Transport */}
            <div className="flex items-center gap-6">
              <button
                onClick={toggleShuffle}
                className={`rounded p-1.5 transition-colors ${
                  player.shuffle ? "text-primary" : "text-soft hover:text-heading"
                }`}
              >
                <Shuffle size={18} />
              </button>
              <button
                onClick={prev}
                className="rounded p-1.5 text-soft transition-colors hover:text-heading"
              >
                <SkipBack size={22} />
              </button>
              <button
                onClick={togglePlay}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-soft text-white transition-transform hover:scale-105 press-effect"
              >
                {player.isPlaying ? (
                  <Pause size={24} fill="currentColor" />
                ) : (
                  <Play size={24} fill="currentColor" className="ml-1" />
                )}
              </button>
              <button
                onClick={next}
                className="rounded p-1.5 text-soft transition-colors hover:text-heading"
              >
                <SkipForward size={22} />
              </button>
              <button
                onClick={cycleRepeat}
                className={`rounded p-1.5 transition-colors ${
                  player.repeat !== "none" ? "text-primary" : "text-soft hover:text-heading"
                }`}
              >
                {player.repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
              </button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-3 w-full max-w-[200px]">
              <button
                onClick={toggleMute}
                className="rounded p-1 text-soft transition-colors hover:text-heading"
              >
                <VolumeIcon size={16} />
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={player.isMuted ? 0 : player.volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-primary
                  [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-heading"
              />
            </div>

            {/* ── Full Queue ── */}
            {player.queue.length > 0 && (
              <div className="w-full pt-2 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <p className="text-xs font-medium text-muted uppercase tracking-wider">
                    Queue
                    <span className="ml-1.5 text-faint">{player.queue.length}</span>
                  </p>
                  <button
                    onClick={() => {
                      dispatch(toggleNowPlaying());
                      dispatch(openRightPanelToTab({ context: "music", tab: "queue" }));
                    }}
                    className="text-xs text-primary hover:text-primary-soft transition-colors"
                  >
                    Open Queue Panel
                  </button>
                </div>
                <div className="overflow-y-auto max-h-[280px] rounded-lg">
                  <div ref={queueListRef} className="space-y-0.5">
                    {player.queue.map((trackId, idx) => {
                      const track = tracks[trackId];
                      if (!track) return null;
                      const isCurrent = idx === player.queueIndex;
                      const img = getTrackImage(track, albums);
                      const isDragSource = dragging?.fromIdx === idx;
                      const isDropTarget = dragging !== null && dropIdx === idx && dropIdx !== dragging.fromIdx;

                      return (
                        <div
                          key={`${trackId}-${idx}`}
                          data-queue-item
                          onClick={() => {
                            if (!dragging) {
                              dispatch(setCurrentTrack({ trackId, queueIndex: idx }));
                            }
                          }}
                          className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/8 ${
                            isCurrent ? "bg-primary/10" : "bg-white/[0.03]"
                          } ${isDragSource ? "opacity-40" : ""} ${
                            isDropTarget
                              ? dropIdx! < dragging!.fromIdx
                                ? "border-t-2 border-primary/60"
                                : "border-b-2 border-primary/60"
                              : ""
                          }`}
                        >
                          <GripVertical
                            size={12}
                            className="shrink-0 cursor-grab text-muted/50 active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleGripMouseDown(e, idx)}
                          />
                          <span className="w-5 text-center text-[10px] tabular-nums shrink-0">
                            {isCurrent ? (
                              <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                            ) : (
                              <span className="text-faint">{idx + 1}</span>
                            )}
                          </span>
                          {img ? (
                            <img src={img} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-card shrink-0">
                              <ListMusic size={14} className="text-muted" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-sm font-medium ${isCurrent ? "text-primary" : "text-heading"}`}>
                              {track.title}
                            </p>
                            <p className="truncate text-xs text-muted">{track.artist}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dispatch(removeFromQueue(idx));
                            }}
                            className="shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-heading"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
