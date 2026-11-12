import { memo, useState } from "react";
import { cn } from "@/lib/utils";

interface ArtworkProps {
  src?: string | null;
  /** Release title: the alt text, and what the placeholder prints. */
  title: string;
  /** Size + radius come from the caller (`h-40 w-40 rounded-lg`, `aspect-square w-full`…). */
  className?: string;
  /** Hide the title on the placeholder (thumbnails too small to hold text). */
  compact?: boolean;
  loading?: "lazy" | "eager";
}

/**
 * Square cover art for tracks, projects and folders.
 *
 * One place for the things every cover needs: a hairline ring so dark covers
 * don't bleed into the background, a fade-in on load, and a placeholder that
 * also covers a broken image URL (which used to show the browser's alt text).
 * The placeholder is a blank sleeve: the title set small in mono on a faint
 * grid, like an unlabelled tape.
 */
export const Artwork = memo(function Artwork({
  src,
  title,
  className,
  compact = false,
  loading = "lazy",
}: ArtworkProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-card ring-1 ring-inset ring-border-light",
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={title}
          loading={loading}
          draggable={false}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            loadedSrc === src ? "opacity-100" : "opacity-0",
          )}
        />
      ) : (
        <div
          aria-label={title}
          role="img"
          className="flex h-full w-full items-end bg-[linear-gradient(var(--color-border-light)_1px,transparent_1px),linear-gradient(90deg,var(--color-border-light)_1px,transparent_1px)] bg-[size:16px_16px] bg-[position:-1px_-1px] p-[9%]"
        >
          {!compact && (
            <span className="line-clamp-2 font-mono text-[10px] lowercase leading-tight tracking-wide text-muted">
              {title}
            </span>
          )}
        </div>
      )}
      {/* Inner hairline above the image, so light covers get an edge too */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/[0.06]" />
    </div>
  );
});
