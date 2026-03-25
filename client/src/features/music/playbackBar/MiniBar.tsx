import { Play, Pause, Maximize2, ListMusic, Headphones } from "lucide-react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { useAudioPlayer } from "../useAudioPlayer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setBarMode, setMiniBarCorner } from "@/store/slices/musicSlice";
import { getTrackImage } from "../trackImage";
import { useState, useRef, useCallback, useEffect } from "react";

const RING_SIZE = 48;
const RING_RADIUS = 21;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** Computes the resting pixel position for each corner */
function getCornerPosition(corner: Corner): { x: number; y: number } {
  const margin = 24; // matches right-6 / left-6 (1.5rem)
  const marginY = 16; // matches top-4 / bottom-4 (1rem)
  const w = window.innerWidth;
  const h = window.innerHeight;

  switch (corner) {
    case "bottom-right": return { x: w - RING_SIZE - margin, y: h - RING_SIZE - marginY };
    case "bottom-left":  return { x: margin, y: h - RING_SIZE - marginY };
    case "top-right":    return { x: w - RING_SIZE - margin, y: marginY };
    case "top-left":     return { x: margin, y: marginY };
  }
}

function nearestCorner(x: number, y: number): Corner {
  const midX = window.innerWidth / 2;
  const midY = window.innerHeight / 2;
  const isRight = x >= midX;
  const isBottom = y >= midY;

  if (isBottom && isRight) return "bottom-right";
  if (isBottom && !isRight) return "bottom-left";
  if (!isBottom && isRight) return "top-right";
  return "top-left";
}

export function MiniBar() {
  const dispatch = useAppDispatch();
  const { currentTrack, player, togglePlay } = useAudioPlayer();
  const albums = useAppSelector((s) => s.music.albums);
  const corner = useAppSelector((s) => s.music.player.miniBarCorner);
  const ltActive = useAppSelector((s) => s.listenTogether.active);
  const ltListenerCount = useAppSelector((s) => s.listenTogether.listeners.length);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{ x: number; y: number; elX: number; elY: number } | null>(null);
  const didDragRef = useRef(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Spring-animated position for snap transitions
  // Initialize at correct corner position to avoid flash to (0,0) on mount
  const initPos = getCornerPosition(corner);
  const motionX = useMotionValue(initPos.x);
  const motionY = useMotionValue(initPos.y);
  const springX = useSpring(motionX, { stiffness: 400, damping: 30 });
  const springY = useSpring(motionY, { stiffness: 400, damping: 30 });

  // Sync spring to corner on mount and corner changes (and window resize)
  const syncToCorner = useCallback(() => {
    const pos = getCornerPosition(corner);
    motionX.set(pos.x);
    motionY.set(pos.y);
  }, [corner, motionX, motionY]);

  useEffect(() => {
    syncToCorner();
    window.addEventListener("resize", syncToCorner);
    return () => window.removeEventListener("resize", syncToCorner);
  }, [syncToCorner]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    didDragRef.current = false;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      elX: motionX.get(),
      elY: motionY.get(),
    };
  }, [motionX, motionY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const start = dragStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;

    // Only start dragging after 5px movement to allow clicks
    if (!isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      setIsDragging(true);
      didDragRef.current = true;
    }

    if (didDragRef.current) {
      // Set directly (skip spring) during drag for responsive feel
      motionX.set(start.elX + dx);
      motionY.set(start.elY + dy);
    }
  }, [isDragging, motionX, motionY]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;

    if (didDragRef.current) {
      // Snap to nearest corner
      const centerX = motionX.get() + RING_SIZE / 2;
      const centerY = motionY.get() + RING_SIZE / 2;
      const newCorner = nearestCorner(centerX, centerY);
      dispatch(setMiniBarCorner(newCorner));

      // Spring animate to final position
      const pos = getCornerPosition(newCorner);
      motionX.set(pos.x);
      motionY.set(pos.y);
    }

    setIsDragging(false);
    didDragRef.current = false;
  }, [dispatch, motionX, motionY]);

  if (!currentTrack) return null;

  const imageUrl = getTrackImage(currentTrack, albums);
  const progress = player.duration > 0 ? player.position / player.duration : 0;
  const strokeOffset = RING_CIRCUMFERENCE * (1 - progress);
  const isLeftCorner = corner === "bottom-left" || corner === "top-left";

  return (
    <motion.div
      key="mini"
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: "spring", duration: 0.25, bounce: 0.15 }}
      style={{ x: springX, y: springY }}
      className={`fixed top-0 left-0 z-40 ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
      onMouseEnter={() => { clearTimeout(hoverTimeoutRef.current); setIsHovered(true); }}
      onMouseLeave={() => { hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 150); }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Expand label — absolutely positioned so it doesn't shift the circle */}
      {isHovered && !isDragging && (
        <>
          {/* Invisible bridge to keep hover alive between circle and expand label */}
          <div className={`absolute top-0 h-full w-4 ${
            isLeftCorner ? "left-full" : "right-full"
          }`} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              dispatch(setBarMode("expanded"));
            }}
            className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-full glass-panel px-3 py-1.5 text-xs text-soft transition-colors hover:text-heading shadow-lg animate-fade-in whitespace-nowrap ${
              isLeftCorner ? "left-full ml-2" : "right-full mr-2"
            }`}
          >
            <Maximize2 size={12} />
            <span className="truncate max-w-[120px]">{currentTrack.title}</span>
            {ltActive && (
              <span className="flex items-center gap-0.5 text-primary">
                <Headphones size={10} />
                {ltListenerCount}
              </span>
            )}
          </button>
        </>
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
            stroke="var(--color-primary-dim)"
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
              <stop offset="0%" stopColor="var(--color-primary)" />
              <stop offset="100%" stopColor="var(--color-primary-soft)" />
            </linearGradient>
          </defs>
        </svg>

        {/* Hover overlay — play/pause */}
        <button
          className={`absolute inset-0 flex items-center justify-center rounded-full transition-opacity ${
            isHovered && !isDragging ? "bg-black/50 opacity-100" : "opacity-0"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            if (!didDragRef.current) togglePlay();
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
