import { memo, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Download, Gauge, Play } from "lucide-react";
import { usePlaybackSpeed, VALID_SPEEDS } from "@/hooks/usePlaybackSpeed";
import { downloadMedia } from "../ui/MediaLightbox";
import { MediaBackdrop } from "./MediaBackdrop";
import { useMediaOrientation } from "./useMediaOrientation";
import {
  CHAT_VIDEO_PLACEHOLDER,
  FEED_ASPECT_CLAMP,
  boundedMediaSize,
  type MediaDensity,
} from "./mediaLayout";
import { useMediaFallback, type MediaFallbackSources } from "./useMediaFallback";
import { MediaUnavailable } from "./MediaUnavailable";

// Keep video heights in sync with SmartImage's density map.
const DENSITY: Record<MediaDensity, { fittedHeight: string; maxH: string }> = {
  feed: { fittedHeight: "h-[26rem]", maxH: "max-h-[24rem]" },
  expanded: { fittedHeight: "h-[34rem]", maxH: "max-h-[32rem]" },
  compact: { fittedHeight: "h-[16rem]", maxH: "max-h-[15rem]" },
  inline: { fittedHeight: "h-[16rem]", maxH: "max-h-60" },
  // Unused: chat cards are sized from the video's own shape (`boundedMediaSize`).
  chat: { fittedHeight: "", maxH: "" },
};

/** `m:ss` / `h:mm:ss` for the duration badge. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export interface SmartVideoProps extends MediaFallbackSources {
  url: string;
  poster?: string;
  /** Optional imeta `dim` ("WxH") for up-front orientation (video kinds). */
  dim?: string;
  downloadable?: boolean;
  density?: MediaDensity;
}

function isHlsUrl(url: string): boolean {
  return url.endsWith(".m3u8") || url.includes("m3u8");
}

/**
 * Orientation-aware inline video player.
 *  - Landscape / square (and pre-load) → natural width, height-capped on a black
 *    backing (the spaces-feed baseline).
 *  - Portrait / reel → shown whole inside a taller card; a blurred poster (when
 *    available) fills the side gaps, otherwise plain black bars (standard reel look).
 *
 * Carries the same speed menu + download affordances as the old `InlineVideo`,
 * and attaches hls.js for `.m3u8` sources where natively unsupported.
 */
export const SmartVideo = memo(function SmartVideo({
  url,
  poster,
  dim,
  downloadable = true,
  density = "feed",
  fallbacks,
  author,
  gated,
}: SmartVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Load-error chain: grant re-mint → by-hash fallbacks → unavailable tile.
  const media = useMediaFallback(url, { fallbacks, author, gated });
  const src = media.src;
  const onMediaError = media.onError;
  const hlsRef = useRef<Hls | null>(null);
  const [playbackRate, setPlaybackRate] = usePlaybackSpeed();
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const { aspect, natural, onLoad } = useMediaOrientation(dim, url);
  // Chat cards hold a clean poster + play button until first play, then
  // hand over to the native controls.
  const [started, setStarted] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  // Resolve orientation AND, when no poster was supplied (plain kind:1 note
  // videos have no imeta thumb), nudge the element to paint its first frame so
  // it isn't a dead black box. This is a *native* seek — no canvas/CORS — so it
  // works on cross-origin hosts where off-screen frame-capture silently fails
  // (the old useVideoThumbnail path returned null on most media hosts → black).
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    onLoad(e);
    const v = e.currentTarget;
    if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    if (!poster && v.currentTime === 0) {
      try {
        v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
      } catch {
        /* not seekable yet — leave the (poster-less) element as-is */
      }
    }
  };

  // Source / HLS setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (isHlsUrl(src) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) onMediaError();
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      // Native MP4/WebM, or native HLS (Safari/WebKit)
      video.src = src;
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, onMediaError]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  if (media.failed) {
    return <MediaUnavailable kind="video" />;
  }

  const d = DENSITY[density];
  const inline = density === "inline";
  const isPortrait = !inline && aspect != null && aspect < FEED_ASPECT_CLAMP.min;
  const isPanorama = !inline && aspect != null && aspect > FEED_ASPECT_CLAMP.max;
  const fitted = isPortrait || isPanorama;

  const overlay = (
    <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
      {downloadable && (
        <button
          onClick={() => src && downloadMedia(src)}
          className="flex items-center rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white/70 opacity-0 backdrop-blur-sm transition-all group-hover/video:opacity-100 hover:bg-black/70 hover:text-white"
          title="Download video"
        >
          <Download size={12} />
        </button>
      )}
      <div className="relative">
        <button
          onClick={() => setShowSpeedMenu((v) => !v)}
          className={`flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm transition-colors ${
            playbackRate !== 1
              ? "bg-indigo-500/20 text-indigo-300"
              : "bg-black/50 text-white/70 opacity-0 group-hover/video:opacity-100"
          }`}
          title="Playback speed"
        >
          <Gauge size={12} />
          <span>{playbackRate}x</span>
        </button>
        {showSpeedMenu && (
          <div className="absolute right-0 top-full mt-1 rounded-xl border border-border card-glass py-1 shadow-lg">
            {VALID_SPEEDS.map((speed) => (
              <button
                key={speed}
                onClick={() => {
                  setPlaybackRate(speed);
                  setShowSpeedMenu(false);
                }}
                className={`block w-full px-3 py-1 text-left text-xs transition-colors ${
                  speed === playbackRate
                    ? "bg-primary/15 text-primary-soft"
                    : "text-body hover:bg-surface-hover"
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Chat / DM attachment: a card at the video's own shape inside the chat
  // box (16:9 until its size is known), poster or first frame, a play button
  // and the duration — native controls appear once it's playing.
  if (density === "chat") {
    const size = boundedMediaSize(natural ?? CHAT_VIDEO_PLACEHOLDER);
    const play = () => {
      const v = videoRef.current;
      if (!v) return;
      setStarted(true);
      void v.play().catch(() => {
        /* autoplay policy / decode error: native controls are showing now */
      });
    };
    return (
      <div
        className="group/video relative max-w-full overflow-hidden rounded-xl bg-black"
        style={{ width: size.width, aspectRatio: size.aspect }}
      >
        {size.fitted && poster && <MediaBackdrop src={poster} active />}
        <video
          ref={videoRef}
          poster={poster}
          controls={started}
          playsInline
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setStarted(true)}
          onError={onMediaError}
          onRateChange={(e) => {
            const rate = (e.target as HTMLVideoElement).playbackRate;
            if (rate !== playbackRate) setPlaybackRate(rate);
          }}
          className="relative z-10 block h-full w-full object-contain"
        />
        {!started && (
          <button
            type="button"
            onClick={play}
            aria-label="Play video"
            className="group/play absolute inset-0 z-20 grid place-items-center"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/20 backdrop-blur-sm transition-transform duration-150 group-hover/play:scale-105 group-hover/play:bg-black/70">
              <Play size={20} className="translate-x-px fill-current" />
            </span>
            {duration != null && (
              <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white/90">
                {formatDuration(duration)}
              </span>
            )}
          </button>
        )}
        {started && overlay}
      </div>
    );
  }

  // Inline (in-text) videos stay small + natural.
  if (inline) {
    return (
      <div className="group/video relative inline-block max-w-xs">
        <video
          ref={videoRef}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onError={onMediaError}
          onRateChange={(e) => {
            const rate = (e.target as HTMLVideoElement).playbackRate;
            if (rate !== playbackRate) setPlaybackRate(rate);
          }}
          className={`max-w-full ${d.maxH} rounded-lg bg-black`}
        />
        {overlay}
      </div>
    );
  }

  // One full-width card for every aspect — mirrors SmartImage. `object-contain`
  // centers the video by construction; portrait/panorama get a definite box +
  // blurred backdrop fill (when a poster exists); landscape/square are
  // media-driven up to the height cap. Full-width so it lines up with images.
  const boxClass = isPortrait ? d.fittedHeight : isPanorama ? "aspect-[16/9]" : "";
  return (
    <div className={`group/video relative w-full overflow-hidden rounded-lg bg-black ${boxClass}`}>
      {fitted && poster && <MediaBackdrop src={poster} active />}
      <video
        ref={videoRef}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onError={onMediaError}
        onRateChange={(e) => {
          const rate = (e.target as HTMLVideoElement).playbackRate;
          if (rate !== playbackRate) setPlaybackRate(rate);
        }}
        className={`relative z-10 mx-auto block w-full ${fitted ? "h-full" : d.maxH} object-contain`}
      />
      {overlay}
    </div>
  );
});
