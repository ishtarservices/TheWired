import { Play, Pause, Maximize2, ListMusic } from "lucide-react";
import { motion } from "motion/react";
import { useAudioPlayer } from "../useAudioPlayer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setBarMode } from "@/store/slices/musicSlice";
import { getTrackImage } from "../trackImage";
import { useState } from "react";

const RING_SIZE = 48;
const RING_RADIUS = 21;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function MiniBar() {
  const dispatch = useAppDispatch();
  const { currentTrack, player, togglePlay } = useAudioPlayer();
  const albums = useAppSelector((s) => s.music.albums);
  const [isHovered, setIsHovered] = useState(false);

  if (!currentTrack) return null;

  const imageUrl = getTrackImage(currentTrack, albums);
  const progress = player.duration > 0 ? player.position / player.duration : 0;
  const strokeOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <motion.div
      key="mini"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: "spring", duration: 0.25, bounce: 0.15 }}
      className="fixed bottom-4 right-6 z-40 flex items-center gap-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Expand label — visible on hover */}
      {isHovered && (
        <button
          onClick={() => dispatch(setBarMode("expanded"))}
          className="flex items-center gap-1.5 rounded-full glass-panel px-3 py-1.5 text-xs text-soft transition-colors hover:text-heading shadow-lg animate-fade-in"
        >
          <Maximize2 size={12} />
          <span className="truncate max-w-[120px]">{currentTrack.title}</span>
        </button>
      )}

      {/* Main circle */}
      <div className="relative h-12 w-12">
        {/* Album art background */}
        <div className="absolute inset-0 overflow-hidden rounded-full">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={currentTrack.title}
              className="h-full w-full object-cover"
              style={{
                animation: player.isPlaying ? "spin 8s linear infinite" : "none",
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-card">
              <ListMusic size={18} className="text-muted" />
            </div>
          )}
        </div>

        {/* SVG progress ring */}
        <svg
          className="absolute inset-0 -rotate-90"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(139, 92, 246, 0.2)"
            strokeWidth={2}
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="url(#miniProgressGradient)"
            strokeWidth={2}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={strokeOffset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-300"
          />
          <defs>
            <linearGradient id="miniProgressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--color-pulse)" />
              <stop offset="100%" stopColor="var(--color-neon)" />
            </linearGradient>
          </defs>
        </svg>

        {/* Hover overlay — play/pause on left half click, expand on right half */}
        <button
          className={`absolute inset-0 flex items-center justify-center rounded-full transition-opacity ${
            isHovered ? "bg-black/50 opacity-100" : "opacity-0"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          title={player.isPlaying ? "Pause" : "Play"}
        >
          {player.isPlaying ? (
            <Pause size={18} className="text-white" fill="currentColor" />
          ) : (
            <Play size={18} className="text-white ml-0.5" fill="currentColor" />
          )}
        </button>
      </div>
    </motion.div>
  );
}
