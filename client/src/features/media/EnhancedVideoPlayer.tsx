import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Gauge,
  X,
  Heart,
  Bookmark,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

interface EnhancedVideoPlayerProps {
  src: string;
  poster?: string;
  title?: string;
  authorName?: string;
  onClose?: () => void;
  className?: string;
}

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function EnhancedVideoPlayer({
  src,
  poster,
  title,
  authorName,
  onClose,
  className,
}: EnhancedVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [favorited, setFavorited] = useState(false);

  // HLS / source setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const isHls = src.endsWith(".m3u8") || src.includes("m3u8");

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    } else {
      video.src = src;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  // Sync playback rate
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideControlsTimer.current);
    if (playing) {
      hideControlsTimer.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [playing]);

  useEffect(() => {
    if (!playing) {
      setShowControls(true);
      clearTimeout(hideControlsTimer.current);
    } else {
      resetHideTimer();
    }
    return () => clearTimeout(hideControlsTimer.current);
  }, [playing, resetHideTimer]);

  // Fullscreen change listener
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Video event handlers
  function onTimeUpdate() {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }
  function onLoadedMetadata() {
    if (videoRef.current) setDuration(videoRef.current.duration);
  }
  function onPlay() { setPlaying(true); }
  function onPause() { setPlaying(false); }
  function onEnded() { setPlaying(false); }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * duration;
  }

  function changeVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  }

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`group relative overflow-hidden rounded-lg bg-black ${className ?? ""}`}
      onMouseMove={resetHideTimer}
      onClick={(e) => {
        // Only toggle play if clicking the video area, not controls
        if ((e.target as HTMLElement).closest("[data-controls]")) return;
        togglePlay();
      }}
    >
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        className="h-full w-full"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
      />

      {/* Center play button when paused */}
      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/50 p-4">
            <Play size={32} className="text-white" fill="white" />
          </div>
        </div>
      )}

      {/* Close button (top-right) */}
      {onClose && (
        <button
          data-controls
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute right-3 top-3 z-20 rounded-full bg-black/60 p-1.5 text-white/80 hover:bg-black/80 hover:text-white"
        >
          <X size={18} />
        </button>
      )}

      {/* Controls overlay */}
      <div
        data-controls
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-3 pt-10 transition-opacity duration-200 ${
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title + author */}
        {(title || authorName) && (
          <div className="mb-2">
            {title && <p className="text-sm font-medium text-white">{title}</p>}
            {authorName && (
              <p className="text-xs text-slate-400">{authorName}</p>
            )}
          </div>
        )}

        {/* Progress bar */}
        <div
          className="group/progress mb-2 cursor-pointer py-1"
          onClick={seek}
        >
          <div className="h-1 overflow-hidden rounded-full bg-white/20 transition-all group-hover/progress:h-1.5">
            <div
              className="h-full rounded-full bg-indigo-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button onClick={togglePlay} className="text-white hover:text-indigo-400">
            {playing ? <Pause size={18} /> : <Play size={18} fill="white" />}
          </button>

          {/* Time */}
          <span className="min-w-[80px] text-xs text-slate-300">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Volume */}
          <button onClick={toggleMute} className="text-white hover:text-indigo-400">
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={changeVolume}
            className="h-1 w-16 cursor-pointer accent-indigo-500"
          />

          {/* Spacer */}
          <div className="flex-1" />

          {/* Social buttons */}
          <button
            onClick={() => setLiked((v) => { if (v) return false; setDisliked(false); return true; })}
            className={`transition-colors ${liked ? "text-indigo-400" : "text-white/60 hover:text-white"}`}
            title="Like"
          >
            <ThumbsUp size={15} fill={liked ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => setDisliked((v) => { if (v) return false; setLiked(false); return true; })}
            className={`transition-colors ${disliked ? "text-red-400" : "text-white/60 hover:text-white"}`}
            title="Dislike"
          >
            <ThumbsDown size={15} fill={disliked ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => setFavorited((v) => !v)}
            className={`transition-colors ${favorited ? "text-red-400" : "text-white/60 hover:text-white"}`}
            title="Favorite"
          >
            <Heart size={15} fill={favorited ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => setBookmarked((v) => !v)}
            className={`transition-colors ${bookmarked ? "text-yellow-400" : "text-white/60 hover:text-white"}`}
            title="Add to Playlist"
          >
            <Bookmark size={15} fill={bookmarked ? "currentColor" : "none"} />
          </button>

          {/* Speed */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu((v) => !v)}
              className={`flex items-center gap-0.5 text-xs transition-colors ${
                playbackRate !== 1 ? "text-indigo-400" : "text-white/60 hover:text-white"
              }`}
              title="Playback speed"
            >
              <Gauge size={14} />
              <span>{playbackRate}x</span>
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-full right-0 mb-1 rounded-md border border-slate-700 bg-slate-900 py-1 shadow-lg">
                {PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    onClick={() => { setPlaybackRate(speed); setShowSpeedMenu(false); }}
                    className={`block w-full px-3 py-1 text-left text-xs transition-colors ${
                      speed === playbackRate
                        ? "bg-indigo-500/20 text-indigo-300"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="text-white/60 hover:text-white">
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
