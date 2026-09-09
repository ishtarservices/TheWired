import { memo } from "react";
import { Music, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { SignalLine } from "./SignalLine";

/**
 * A compact playable row. Shows title, artist and the why-line — never a play
 * count (plays are authed server-side and guests never register, so any number
 * would be a lie of omission).
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
  return (
    <div>
      <button
        type="button"
        onClick={onActivate}
        disabled={busy}
        aria-label={`${marker === "ALBUM" ? "Open" : "Play"} ${title}`}
        className={cn(
          "group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60",
          isCurrent && "bg-surface",
        )}
      >
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-card">
          {imageUrl ? (
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Music size={16} className="text-muted" />
            </div>
          )}
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity",
              isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {isCurrent && isPlaying ? (
              <Pause size={14} className="text-white" />
            ) : (
              <Play size={14} className="text-white" />
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={cn("truncate text-sm", isCurrent ? "text-primary" : "text-heading")}>{title}</p>
            {marker && (
              <span className="shrink-0 font-mono text-[9px] tabular-nums text-faint">{marker}</span>
            )}
          </div>
          <p className="truncate text-xs text-soft">{artist}</p>
        </div>
        <SignalLine label={signal} className="shrink-0" />
      </button>
      {error && (
        <p className="px-2 pb-1 text-[11px] text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
