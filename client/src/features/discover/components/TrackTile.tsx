import { memo } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Artwork } from "@/features/music/Artwork";
import { SignalLine } from "./SignalLine";

/**
 * A loose track on the wall: cover, play on hover, the equaliser while it is
 * the one playing. Under it title, artist and the why-line. Never a play
 * count (plays are authed server-side and guests never register, so any
 * number would be a lie of omission).
 */
export const TrackTile = memo(function TrackTile({
  title,
  artist,
  imageUrl,
  signal,
  isCurrent,
  isPlaying,
  onActivate,
}: {
  title: string;
  artist: string;
  imageUrl?: string | null;
  signal: string | null;
  isCurrent?: boolean;
  isPlaying?: boolean;
  onActivate: () => void;
}) {
  const playing = !!isCurrent && !!isPlaying;
  return (
    <button
      type="button"
      onClick={onActivate}
      aria-label={`Play ${title}`}
      className="group flex w-full flex-col rounded-lg text-left outline-offset-4"
    >
      <span className="relative block w-full">
        <Artwork
          src={imageUrl}
          title={title}
          className="aspect-square w-full rounded-lg shadow-[var(--shadow-sm)] transition-[filter,box-shadow] duration-200 group-hover:shadow-[var(--shadow-lg)] group-hover:brightness-90"
        />
        <span
          className={cn(
            "absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-heading text-background shadow-[var(--shadow-md)] transition-all duration-200 ease-out",
            isCurrent
              ? "opacity-100"
              : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
          )}
        >
          {isCurrent ? (
            <span className="eq-bars" data-paused={!playing} aria-hidden>
              <span />
              <span />
              <span />
            </span>
          ) : (
            <Play size={15} fill="currentColor" className="ml-0.5" />
          )}
        </span>
      </span>
      <span className="block w-full px-0.5 pt-2.5">
        <span className={cn("block truncate text-[13px] font-medium", isCurrent ? "text-primary" : "text-heading")}>
          {title}
        </span>
        <span className="mt-0.5 flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">{artist}</span>
          <SignalLine label={signal} className="shrink-0" />
        </span>
      </span>
    </button>
  );
});
