import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";
import { cn } from "@/lib/utils";
import type { TileFit } from "@/types/calling";

interface VideoSurfaceProps {
  track: Track | null;
  fit: TileFit;
  mirror?: boolean;
  className?: string;
}

/**
 * The ONLY place a LiveKit video track is attached to a <video>. Re-attaches
 * whenever the track identity changes (camera re-published, screen share
 * restarted), which is what removes the old polling attach loops.
 *
 * Always muted: audio plays through the remoteAudio registry, never here
 * (attaching audio in two places doubles it).
 */
export function VideoSurface({ track, fit, mirror, className }: VideoSurfaceProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => {
      track.detach(el);
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
