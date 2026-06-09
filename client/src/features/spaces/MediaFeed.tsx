import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { Play, ImageIcon, Maximize2, ExternalLink, Download } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { useNearViewport } from "../../hooks/useNearViewport";
import { videoLoadQueue } from "../../lib/media/mediaLoadQueue";
import { createLogger } from "../../lib/debug/logger";
import { usePlaybackBarSpacing } from "../../hooks/usePlaybackBarSpacing";
import { selectSpaceMediaEvents } from "./spaceSelectors";
import { EVENT_KINDS } from "../../types/nostr";
import type { NostrEvent } from "../../types/nostr";
import { EnhancedVideoPlayer } from "../media/EnhancedVideoPlayer";
import { useZap } from "../wallet/WalletProvider";
import { parseVideoEvent, selectVideoSource } from "../media/imetaParser";
import { orientationFromDimString } from "../../components/media";
import { Avatar } from "../../components/ui/Avatar";
import { RichContent } from "../../components/content/RichContent";
import { useProfile } from "../profile/useProfile";
import { extractMediaUrls, stripMediaUrls } from "../../lib/media/mediaUrlParser";
import { matchEmbed, type EmbedMatch, type EmbedPlatform } from "../../lib/content/embedPatterns";
import { downloadMedia } from "../../components/ui/MediaLightbox";
import { useScrollRestore } from "../../hooks/useScrollRestore";
import { useFeedPagination } from "./useFeedPagination";
import { FeedToolbar } from "./FeedToolbar";
import { LoadMoreButton } from "./LoadMoreButton";
import { RevealSentinel } from "../../components/ui/RevealSentinel";

const feedLog = createLogger("feed");

/** How many tiles to add to the rendered window each time the sentinel is hit. */
const RENDER_PAGE = 30;

// ── Types ────────────────────────────────────────────────────────

type MediaItemType = "image" | "video" | "embed";

interface MediaItem {
  key: string;
  type: MediaItemType;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  event: NostrEvent;
  caption?: string;
  embed?: EmbedMatch;
}

// ── Helpers ──────────────────────────────────────────────────────

const VIDEO_KINDS = new Set<number>([
  EVENT_KINDS.VIDEO_HORIZONTAL,
  EVENT_KINDS.VIDEO_VERTICAL,
  EVENT_KINDS.VIDEO_HORIZONTAL_ADDR,
  EVENT_KINDS.VIDEO_VERTICAL_ADDR,
]);

function eventToMediaItems(event: NostrEvent): MediaItem[] {
  if (event.kind === EVENT_KINDS.PICTURE) {
    const url =
      event.tags.find((t) => t[0] === "url")?.[1] ?? event.content.trim();
    if (!url || !url.startsWith("http")) return [];
    return [{ key: `${event.id}:img`, type: "image", url, event }];
  }

  if (VIDEO_KINDS.has(event.kind)) {
    const video = parseVideoEvent(event);
    const sourceUrl = selectVideoSource(video.variants);
    if (!sourceUrl) return [];
    return [{
      key: `${event.id}:vid`,
      type: "video",
      url: sourceUrl,
      thumbnailUrl: video.thumbnail,
      title: video.title,
      event,
    }];
  }

  if (event.kind === EVENT_KINDS.SHORT_TEXT) {
    const items: MediaItem[] = [];
    const caption = stripMediaUrls(event.content);

    // Direct media URLs (images/videos)
    const extracted = extractMediaUrls(event.content);
    for (let i = 0; i < extracted.length; i++) {
      items.push({
        key: `${event.id}:${i}`,
        type: extracted[i].type === "video" ? "video" : "image",
        url: extracted[i].url,
        caption: caption || undefined,
        event,
      });
    }

    // Embed URLs (YouTube, Twitter, etc.)
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
    for (const match of event.content.matchAll(urlRegex)) {
      const url = match[0].replace(/[),.:;!?]+$/, "");
      const embed = matchEmbed(url);
      if (embed) {
        items.push({
          key: `${event.id}:embed:${embed.platform}:${embed.id}`,
          type: "embed",
          url: embed.originalUrl,
          embed,
          caption: caption || undefined,
          event,
        });
      }
    }

    return items;
  }

  return [];
}

// ── Sub-components ───────────────────────────────────────────────

/** Characters after which we show the "more" expand button */
const CAPTION_TRUNCATE = 60;

function AuthorBadge({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  return (
    <div className="flex items-center gap-1.5">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <span className="truncate text-xs text-soft">{name}</span>
    </div>
  );
}

/** Get display text for a media item (caption from notes, title from video events) */
function getItemText(item: MediaItem): string | undefined {
  return item.caption || item.title;
}

/**
 * Card footer: author badge + truncated text preview.
 * Clicking "more" opens the focused expanded view (onExpand callback).
 */
function CardFooter({
  item,
  onExpand,
}: {
  item: MediaItem;
  onExpand: () => void;
}) {
  const text = getItemText(item);
  const isTruncatable = !!text && text.length > CAPTION_TRUNCATE;

  return (
    <div className="p-2">
      <AuthorBadge pubkey={item.event.pubkey} />
      {text && (
        <div className="mt-1">
          <p className="line-clamp-2 text-[11px] leading-relaxed text-soft">
            {text}
          </p>
          {isTruncatable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onExpand();
              }}
              className="mt-0.5 flex items-center gap-1 text-[10px] text-indigo-400/70 transition-colors hover:text-indigo-300"
            >
              <Maximize2 size={9} />
              more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ImageThumbnail = memo(function ImageThumbnail({
  item,
  onClick,
}: {
  item: MediaItem;
  onClick: () => void;
}) {
  const [errored, setErrored] = useState(false);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <button
        onClick={onClick}
        className="group relative w-full shrink-0"
      >
        {errored ? (
          <div className="flex aspect-square w-full items-center justify-center bg-surface">
            <ImageIcon size={32} className="text-muted" />
          </div>
        ) : (
          <img
            src={item.url}
            alt={item.caption ?? ""}
            className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        )}
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
      </button>
      <CardFooter item={item} onExpand={onClick} />
    </div>
  );
});

/** Last URL path segment, for compact log lines. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return seg.length > 24 ? `${seg.slice(0, 24)}…` : seg;
  } catch {
    return url.slice(-24);
  }
}

/**
 * Renders one video grid frame. The concurrency slot is tied to this component's
 * mount/unmount: acquire on mount, set `src` once granted, seek a first frame,
 * release on seeked/error/unmount. The parent mounts it only while the tile is
 * near the viewport (non-sticky), so the set of *loading* videos stays bounded
 * to roughly what's on screen no matter how long the feed gets.
 */
function LazyVideoFrame({ url }: { url: string }) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const holdingRef = useRef(false);
  const doneRef = useRef(false);
  const startRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    feedLog.debug(`media: video enqueue ${shortUrl(url)}`, videoLoadQueue.stats());
    videoLoadQueue.acquire().then(() => {
      if (cancelled) {
        videoLoadQueue.release(); // granted after we unmounted — hand it on
        return;
      }
      holdingRef.current = true;
      startRef.current = performance.now();
      feedLog.debug(`media: video load-start ${shortUrl(url)}`, videoLoadQueue.stats());
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (holdingRef.current && !doneRef.current) {
        holdingRef.current = false;
        videoLoadQueue.release();
      }
    };
  }, [url]);

  const finish = (how: "seeked" | "metadata" | "error") => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (holdingRef.current) {
      holdingRef.current = false;
      videoLoadQueue.release();
    }
    const ms = startRef.current ? Math.round(performance.now() - startRef.current) : 0;
    if (how === "error") {
      feedLog.warn(`media: video frame failed ${shortUrl(url)}`, videoLoadQueue.stats());
    } else {
      feedLog.debug(`media: video frame ${how} ${shortUrl(url)} (${ms}ms)`, videoLoadQueue.stats());
    }
  };

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface">
        <Play size={28} className="text-muted/40" />
      </div>
    );
  }
  return (
    <video
      src={src}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        if (v.currentTime === 0) {
          try {
            v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
            return;
          } catch {
            /* not seekable — finish below */
          }
        }
        finish("metadata");
      }}
      onSeeked={() => finish("seeked")}
      onError={() => finish("error")}
      className="h-full w-full object-cover"
    />
  );
}

const VideoThumbnail = memo(function VideoThumbnail({
  item,
  onClick,
}: {
  item: MediaItem;
  onClick: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPoster = !!item.thumbnailUrl;
  // Non-sticky window: mount the frame loader only while on/near screen, unmount
  // when it scrolls well away — that's what releases the queue slot + connection.
  const near = useNearViewport(containerRef, "600px", false);

  return (
    <div
      ref={containerRef}
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface"
    >
      <button
        onClick={onClick}
        className="group relative w-full shrink-0"
      >
        <div className="aspect-square w-full bg-surface">
          {hasPoster ? (
            <img
              src={item.thumbnailUrl}
              alt={item.title ?? "Video"}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : near ? (
            <LazyVideoFrame url={item.url} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface">
              <Play size={28} className="text-muted/40" />
            </div>
          )}
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40">
          <div className="rounded-full bg-black/50 p-3 transition-transform group-hover:scale-110">
            <Play size={24} className="text-white" fill="white" />
          </div>
        </div>
      </button>
      <CardFooter item={item} onExpand={onClick} />
    </div>
  );
});

// ── Embed constants ──────────────────────────────────────────────

const PLATFORM_LABELS: Record<EmbedPlatform, string> = {
  youtube: "YouTube",
  twitter: "X (Twitter)",
  spotify: "Spotify",
  tiktok: "TikTok",
  instagram: "Instagram",
  tenor: "Tenor GIF",
};

const PLATFORM_ICONS: Record<EmbedPlatform, { bg: string; accent: string }> = {
  youtube: { bg: "bg-red-500/15", accent: "text-red-400" },
  twitter: { bg: "bg-sky-400/15", accent: "text-sky-400" },
  spotify: { bg: "bg-green-500/15", accent: "text-green-400" },
  tiktok: { bg: "bg-pink-500/15", accent: "text-pink-400" },
  instagram: { bg: "bg-purple-500/15", accent: "text-purple-400" },
  tenor: { bg: "bg-blue-400/15", accent: "text-blue-400" },
};

const YOUTUBE_THUMB_URL = (id: string) =>
  `https://img.youtube.com/vi/${id}/mqdefault.jpg`;

const EmbedThumbnail = memo(function EmbedThumbnail({
  item,
  onClick,
}: {
  item: MediaItem;
  onClick: () => void;
}) {
  const embed = item.embed!;
  const style = PLATFORM_ICONS[embed.platform];
  const hasThumb = embed.platform === "youtube";

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <button
        onClick={onClick}
        className="group relative w-full shrink-0"
      >
        <div className="aspect-square w-full bg-surface">
          {hasThumb ? (
            <img
              src={YOUTUBE_THUMB_URL(embed.id)}
              alt={item.caption ?? PLATFORM_LABELS[embed.platform]}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2">
              <div className={`rounded-xl p-3 ${style.bg}`}>
                <ExternalLink size={24} className={style.accent} />
              </div>
              <span className={`text-xs font-medium ${style.accent}`}>
                {PLATFORM_LABELS[embed.platform]}
              </span>
            </div>
          )}
        </div>
        {/* Overlay with platform badge */}
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/20" />
        <div className="absolute left-2 top-2">
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm ${style.bg} ${style.accent}`}>
            {PLATFORM_LABELS[embed.platform]}
          </span>
        </div>
        {embed.platform === "youtube" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full bg-red-600/90 p-2.5 transition-transform group-hover:scale-110">
              <Play size={18} className="text-white" fill="white" />
            </div>
          </div>
        )}
      </button>
      <CardFooter item={item} onExpand={onClick} />
    </div>
  );
});

function ExpandedEmbedView({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const embed = item.embed!;
  const text = getItemText(item);
  const [iframeError, setIframeError] = useState(false);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-soft hover:bg-surface-hover hover:text-heading"
        >
          Back
        </button>
        <div className="flex-1" />
        <span className={`text-xs font-medium ${PLATFORM_ICONS[embed.platform].accent}`}>
          {PLATFORM_LABELS[embed.platform]}
        </span>
        <a
          href={embed.originalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-soft hover:bg-surface-hover hover:text-heading"
        >
          Open <ExternalLink size={11} />
        </a>
      </div>
      <div className="flex flex-1 flex-col items-center overflow-y-auto p-4">
        {embed.embedUrl && !iframeError ? (
          <div className="w-full max-w-3xl">
            <div className={getEmbedAspect(embed.platform)}>
              <iframe
                src={embed.embedUrl}
                title={`${PLATFORM_LABELS[embed.platform]} embed`}
                className="absolute inset-0 h-full w-full rounded-lg"
                sandbox="allow-scripts allow-same-origin allow-popups"
                loading="lazy"
                allowFullScreen
                allow="autoplay; encrypted-media"
                onError={() => setIframeError(true)}
              />
            </div>
          </div>
        ) : (
          <div className="flex w-full max-w-3xl flex-col items-center justify-center rounded-lg border border-border bg-surface p-8">
            <div className={`rounded-xl p-4 ${PLATFORM_ICONS[embed.platform].bg}`}>
              <ExternalLink size={32} className={PLATFORM_ICONS[embed.platform].accent} />
            </div>
            <p className="mt-3 text-sm text-soft">
              {iframeError ? "Embed failed to load" : "Embeds not available for this platform"}
            </p>
            <a
              href={embed.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center gap-1.5 rounded-md bg-surface-hover px-3 py-1.5 text-xs font-medium text-heading hover:bg-surface-hover transition-colors"
            >
              Open on {PLATFORM_LABELS[embed.platform]} <ExternalLink size={12} />
            </a>
          </div>
        )}
        {text && (
          <div className="mt-4 w-full max-w-3xl rounded-lg border border-border bg-surface p-4">
            <AuthorBadge pubkey={item.event.pubkey} />
            <div className="mt-2 text-sm leading-relaxed text-body">
              <RichContent content={text} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getEmbedAspect(platform: EmbedPlatform): string {
  switch (platform) {
    case "youtube":
      return "relative w-full aspect-video";
    case "spotify":
      return "relative w-full h-[152px]";
    case "tiktok":
      return "relative w-[325px] h-[580px] mx-auto";
    case "twitter":
      return "relative w-full h-[500px]";
    default:
      return "relative w-full aspect-video";
  }
}

function ExpandedVideoView({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const { profile } = useProfile(item.event.pubkey);
  const { openZap } = useZap();
  const authorName =
    profile?.display_name ||
    profile?.name ||
    item.event.pubkey.slice(0, 8) + "...";
  const text = getItemText(item);

  // Orientation: prefer the imeta `dim`; fall back to the vertical-video kinds.
  const dim = parseVideoEvent(item.event).variants[0]?.dim;
  const isVerticalKind =
    item.event.kind === EVENT_KINDS.VIDEO_VERTICAL ||
    item.event.kind === EVENT_KINDS.VIDEO_VERTICAL_ADDR;
  const orientation = orientationFromDimString(dim);
  const portrait =
    orientation === "portrait" || (orientation === "unknown" && isVerticalKind);

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto bg-black p-4">
      <div className="mb-2 flex w-full max-w-4xl items-center justify-end">
        <button
          onClick={() => downloadMedia(item.url)}
          className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors"
          title="Download video"
        >
          <Download size={13} />
          Download
        </button>
      </div>
      <div className="w-full max-w-4xl">
        <EnhancedVideoPlayer
          src={item.url}
          poster={item.thumbnailUrl}
          title={item.title ?? item.caption}
          authorName={authorName}
          onClose={onClose}
          className={
            portrait
              ? "mx-auto aspect-[9/16] h-[80vh]"
              : "aspect-video w-full"
          }
          onZap={() => openZap({ recipientPubkey: item.event.pubkey, event: item.event })}
        />
      </div>
      {text && (
        <div className="mt-4 w-full max-w-4xl rounded-lg border border-border bg-surface p-4">
          <AuthorBadge pubkey={item.event.pubkey} />
          <div className="mt-2 text-sm leading-relaxed text-body">
            <RichContent content={text} />
          </div>
        </div>
      )}
    </div>
  );
}

function ExpandedImageView({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const text = getItemText(item);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-soft hover:bg-surface-hover hover:text-heading"
        >
          Back
        </button>
        <div className="flex-1" />
        <button
          onClick={() => downloadMedia(item.url)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-soft hover:bg-surface-hover hover:text-heading transition-colors"
          title="Download image"
        >
          <Download size={13} />
          Download
        </button>
        <AuthorBadge pubkey={item.event.pubkey} />
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto p-4">
        <img
          src={item.url}
          alt={item.caption ?? ""}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
      {text && (
        <div className="border-t border-border px-4 py-3">
          <div className="text-sm text-soft">
            <RichContent content={text} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter tabs ──────────────────────────────────────────────────

type FilterTab = "all" | "images" | "videos" | "embeds";

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-primary/15 text-primary-soft"
          : "text-soft hover:bg-surface-hover hover:text-heading"
      }`}
    >
      {label}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────

export function MediaFeed() {
  const mediaEvents = useAppSelector(selectSpaceMediaEvents);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const [activeItem, setActiveItem] = useState<MediaItem | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  // Cap how many tiles are actually rendered; grow it as the user scrolls. This
  // keeps the DOM (and per-event-batch re-render cost) bounded no matter how many
  // media items the feed holds, and makes tab switches cheap (resets to one page).
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE);
  const scrollRef = useScrollRestore(activeChannelId);
  const { meta, refresh, loadMore } = useFeedPagination("media");
  // The media channel only subscribes to dedicated media kinds (20/21/22/34235),
  // so note-derived media + embeds only appear once kind:1 notes are fetched and
  // cross-indexed (eventPipeline). Ensure notes are fetched too — this is a no-op
  // when they're already loaded (guarded on event count), so it doesn't refetch.
  useFeedPagination("notes");
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  const allItems = useMemo(() => {
    const items: MediaItem[] = [];
    const seenUrls = new Set<string>();
    const sorted = [...mediaEvents].sort(
      (a, b) => b.created_at - a.created_at,
    );

    for (const ev of sorted) {
      for (const item of eventToMediaItems(ev)) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          items.push(item);
        }
      }
    }
    return items;
  }, [mediaEvents]);

  // NOTE: we deliberately do NOT eagerly preload every image/thumbnail here.
  // Doing so `new Image()`-loaded the entire feed at once (hundreds of requests),
  // saturating the connection pool and starving the relay sockets + the clip the
  // user actually clicks to play. Tiles load lazily instead (`loading="lazy"` on
  // images, viewport-gated + concurrency-queued for videos).

  // Trace feed composition so throttling is diagnosable via `wiredDebug` (feed).
  useEffect(() => {
    const img = allItems.filter((m) => m.type === "image").length;
    const vid = allItems.filter((m) => m.type === "video").length;
    const emb = allItems.filter((m) => m.type === "embed").length;
    feedLog.debug(
      `media feed: ${allItems.length} items (img=${img} vid=${vid} embed=${emb})`,
    );
  }, [allItems]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return allItems;
    if (filter === "images") return allItems.filter((m) => m.type === "image");
    if (filter === "videos") return allItems.filter((m) => m.type === "video");
    return allItems.filter((m) => m.type === "embed");
  }, [allItems, filter]);

  // Switching tabs starts a fresh render window (don't render hundreds at once).
  useEffect(() => {
    setRenderLimit(RENDER_PAGE);
  }, [filter]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, renderLimit),
    [filteredItems, renderLimit],
  );
  const hasMoreLocal = renderLimit < filteredItems.length;
  const revealMore = useCallback(() => setRenderLimit((n) => n + RENDER_PAGE), []);

  const imageCount = allItems.filter((m) => m.type === "image").length;
  const videoCount = allItems.filter((m) => m.type === "video").length;
  const embedCount = allItems.filter((m) => m.type === "embed").length;

  // Log the play/expand intent alongside the load-queue state, so a "won't play"
  // can be correlated with connection-pool saturation in the exported trace.
  const handleExpand = useCallback((item: MediaItem) => {
    feedLog.debug(`media: expand ${item.type}`, videoLoadQueue.stats());
    setActiveItem(item);
  }, []);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <FeedToolbar isRefreshing={meta.isRefreshing} onRefresh={refresh}>
        {allItems.length > 0 && (
          <>
            <TabButton
              active={filter === "all"}
              onClick={() => setFilter("all")}
              label={`All (${allItems.length})`}
            />
            {imageCount > 0 && (
              <TabButton
                active={filter === "images"}
                onClick={() => setFilter("images")}
                label={`Images (${imageCount})`}
              />
            )}
            {videoCount > 0 && (
              <TabButton
                active={filter === "videos"}
                onClick={() => setFilter("videos")}
                label={`Videos (${videoCount})`}
              />
            )}
            {embedCount > 0 && (
              <TabButton
                active={filter === "embeds"}
                onClick={() => setFilter("embeds")}
                label={`Embeds (${embedCount})`}
              />
            )}
          </>
        )}
      </FeedToolbar>

      {/* Grid */}
      <div ref={scrollRef} className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
        {filteredItems.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              No media yet from space members
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {visibleItems.map((item) => {
                if (item.type === "embed") {
                  return (
                    <EmbedThumbnail
                      key={item.key}
                      item={item}
                      onClick={() => handleExpand(item)}
                    />
                  );
                }
                if (item.type === "video") {
                  return (
                    <VideoThumbnail
                      key={item.key}
                      item={item}
                      onClick={() => handleExpand(item)}
                    />
                  );
                }
                return (
                  <ImageThumbnail
                    key={item.key}
                    item={item}
                    onClick={() => handleExpand(item)}
                  />
                );
              })}
            </div>
            {/* Reveal more rendered tiles as you approach the end; once the whole
                fetched set is shown, fall back to fetching more from the relay. */}
            {hasMoreLocal && <RevealSentinel onReach={revealMore} />}
            <LoadMoreButton
              isLoading={meta.isLoadingMore}
              hasMore={!hasMoreLocal && meta.hasMore}
              onLoadMore={loadMore}
            />
          </>
        )}
      </div>

      {/* Expanded media — overlay so the grid (and its scroll position) stays mounted */}
      {activeItem && (
        <div className="absolute inset-0 z-30 flex flex-col bg-background">
          {activeItem.type === "embed" ? (
            <ExpandedEmbedView item={activeItem} onClose={() => setActiveItem(null)} />
          ) : activeItem.type === "video" ? (
            <ExpandedVideoView item={activeItem} onClose={() => setActiveItem(null)} />
          ) : (
            <ExpandedImageView item={activeItem} onClose={() => setActiveItem(null)} />
          )}
        </div>
      )}
    </div>
  );
}
