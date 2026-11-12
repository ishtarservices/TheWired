import { ExternalLink } from "lucide-react";
import { providerLabel, type ExternalMediaItem } from "@/lib/content/musicEmbeds";

const PROVIDER_DOT: Record<ExternalMediaItem["provider"], string> = {
  youtube: "bg-red-500",
  soundcloud: "bg-orange-500",
  bandcamp: "bg-cyan-500",
  spotify: "bg-green-500",
  applemusic: "bg-pink-500",
};

/** Title from the link itself (no OG fetch): the last path slug, spaced out. */
function titleFromUrl(media: ExternalMediaItem): string {
  if (media.title) return media.title;
  try {
    const parts = new URL(media.canonicalUrl).pathname.split("/").filter(Boolean);
    // Apple Music ends in a numeric id; the slug is the segment before it.
    const slug = media.provider === "applemusic" ? parts[parts.length - 2] : parts[parts.length - 1];
    const words = decodeURIComponent(slug ?? "").replace(/[-_]+/g, " ").trim();
    return words || providerLabel(media.provider);
  } catch {
    return providerLabel(media.provider);
  }
}

/**
 * A music provider link in a note or message (SoundCloud, Bandcamp, Apple
 * Music, a YouTube playlist): one compact row that opens the provider, the
 * way soot draws them. Single YouTube videos and Spotify keep their players.
 */
export function MusicLinkCard({ media }: { media: ExternalMediaItem }) {
  const label = providerLabel(media.provider);
  const caption = [label, media.subtype && media.subtype !== "video" ? media.subtype : ""].filter(Boolean).join(" · ");
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 flex w-full max-w-md items-center gap-3 rounded-xl border border-border card-glass px-3 py-2.5 transition-colors hover:border-faint"
      title={`Open on ${label}`}
    >
      {media.thumb ? (
        <img src={media.thumb} alt="" loading="lazy" className="h-12 w-20 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-card">
          <span className={`h-3 w-3 rounded-full ${PROVIDER_DOT[media.provider]}`} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium capitalize text-heading">{titleFromUrl(media)}</span>
        <span className="block truncate text-xs text-soft">{caption}</span>
      </span>
      <ExternalLink size={14} className="shrink-0 text-muted" />
    </a>
  );
}
