import { memo } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Artwork } from "@/features/music/Artwork";
import { SignalLine } from "./SignalLine";

/**
 * A compact row for search results, where tracks and projects come back
 * mixed and a wall of covers would hide which is which. Shows title, artist
 * and the why-line, never a play count (plays are authed server-side and
 * guests never register, so any number would be a lie of omission).
 */
export const TrackRow = memo(function TrackRow({
  title,
  artist,
  imageUrl,
  signal,
  marker,
  isCurrent,
  isPlaying,
  busy,
  error,
  onActivate,
}: {
  title: string;
  artist: string;
  imageUrl?: string | null;
  signal: string | null;
  /** Mono kind marker for mixed search results ("TRACK" / "ALBUM"). */
  marker?: string;
  isCurrent?: boolean;
  isPlaying?: boolean;
  busy?: boolean;
  error?: string | null;
  onActivate: () => void;
}) {
  const playing = !!isCurrent && !!isPlaying;
  return (
    <div className="border-b border-border-light py-1">
      <button
        type="button"
        onClick={onActivate}
        disabled={busy}
        aria-label={`${marker === "ALBUM" ? "Open" : "Play"} ${title}`}
        className={cn(
          "group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors disabled:opacity-60",
          isCurrent ? "bg-surface-hover" : "hover:bg-surface-hover",
        )}
      >
        <span className="relative block h-10 w-10 shrink-0">
          <Artwork src={imageUrl} title={title} compact className="h-10 w-10 rounded-md" />
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-md bg-black/55 text-white transition-opacity",
              isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {isCurrent ? (
              <span className="eq-bars" data-paused={!playing} aria-hidden>
                <span />
                <span />
                <span />
              </span>
            ) : (
              <Play size={14} fill="currentColor" className="ml-0.5" />
            )}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-[13px] font-medium", isCurrent ? "text-primary" : "text-heading")}>
              {title}
            </span>
            {marker && (
              <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-faint">{marker}</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">{artist}</span>
        </span>
        <SignalLine label={signal} className="shrink-0" />
      </button>
      {error && (
        <p className="pb-1 pt-0.5 text-[11px] text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
