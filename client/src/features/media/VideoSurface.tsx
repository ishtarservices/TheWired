import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";
import { cn } from "@/lib/utils";
import type { TileFit } from "@/types/calling";

/** What the element is showing: null until the first frame has arrived. */
export interface VideoFrameInfo {
  /** The picture is taller than it is wide (a phone held upright). */
  portrait: boolean;
}

interface VideoSurfaceProps {
  track: Track | null;
  fit: TileFit;
  mirror?: boolean;
  className?: string;
  /** Called with frame info once a picture is on screen, and with null when
   *  there is none (no track yet, track swapped). */
  onFrame?: (info: VideoFrameInfo | null) => void;
}

// `timeupdate` is the backstop: it keeps firing while a live stream plays, so
// a WebView that skips the others for a MediaStream still gets there.
const FRAME_EVENTS = ["loadedmetadata", "loadeddata", "resize", "playing", "timeupdate"] as const;

/**
 * The ONLY place a LiveKit video track is attached to a <video>. Re-attaches
 * whenever the track identity changes (camera re-published, screen share
 * restarted), which is what removes the old polling attach loops.
 *
 * Always muted: audio plays through the remoteAudio registry, never here
 * (attaching audio in two places doubles it).
 */
export function VideoSurface({ track, fit, mirror, className, onFrame }: VideoSurfaceProps) {
  const ref = useRef<HTMLVideoElement>(null);
  // Latest callback without re-attaching the track when the parent re-renders.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const el = ref.current;
    if (!track || !el) {
      onFrameRef.current?.(null);
      return;
    }
    // An element only knows its picture size once a frame is decoded, and it
    // changes mid-stream (simulcast layer switch, a phone rotating).
    const report = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        onFrameRef.current?.({ portrait: el.videoHeight > el.videoWidth * 1.1 });
      }
    };
    for (const ev of FRAME_EVENTS) el.addEventListener(ev, report);
    track.attach(el);
    report();
    return () => {
      for (const ev of FRAME_EVENTS) el.removeEventListener(ev, report);
      track.detach(el);
      onFrameRef.current?.(null);
    };
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        "h-full w-full bg-black",
        fit === "cover" ? "object-cover" : "object-contain",
        mirror && "scale-x-[-1]",
        className,
      )}
    />
  );
}
