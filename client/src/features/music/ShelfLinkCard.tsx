import { ExternalLink, Music2 } from "lucide-react";
import { providerLabel, type ExternalMediaItem } from "@/lib/content/musicEmbeds";

const PROVIDER_DOT: Record<ExternalMediaItem["provider"], string> = {
  youtube: "bg-red-500",
  soundcloud: "bg-orange-500",
  bandcamp: "bg-cyan-500",
  spotify: "bg-green-500",
  applemusic: "bg-pink-500",
};

interface ShelfLinkCardProps {
  media: ExternalMediaItem;
  /** Rendered under the card (attribution). */
  footer?: React.ReactNode;
}

/**
 * A provider link posted onto a music channel's shelf (YouTube, SoundCloud,
 * Bandcamp, Spotify, Apple Music). Opens in the system browser; only YouTube
 * has a deterministic thumbnail.
 */
export function ShelfLinkCard({ media, footer }: ShelfLinkCardProps) {
  const label = providerLabel(media.provider);
  const title = media.title ?? media.canonicalUrl.replace(/^https?:\/\/(www\.)?/, "");
  return (
    <div className="group flex w-full flex-col overflow-hidden rounded-xl border border-border card-glass transition-all hover:border-border-light hover-lift">
      <a
        href={media.canonicalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-square w-full overflow-hidden rounded-t-xl bg-card"
        title={`Open on ${label}`}
      >
        {media.thumb ? (
          <img src={media.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music2 size={32} className="text-muted" />
          </div>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-background/70 p-1.5 text-soft opacity-0 transition-opacity group-hover:opacity-100">
          <ExternalLink size={12} />
        </span>
      </a>
      <div className="flex flex-col gap-0.5 p-2.5">
        <p className="truncate text-sm text-heading" title={media.canonicalUrl}>{title}</p>
        <p className="flex items-center gap-1.5 text-xs text-soft">
          <span className={`inline-block h-2 w-2 rounded-full ${PROVIDER_DOT[media.provider]}`} />
          {label}
          {media.subtype && <span className="text-muted">· {media.subtype}</span>}
        </p>
        {footer}
      </div>
    </div>
  );
}
