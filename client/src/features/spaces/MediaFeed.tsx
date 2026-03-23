import { useState, useMemo, useEffect, memo } from "react";
import { Play, ImageIcon, Maximize2, ExternalLink } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { usePlaybackBarSpacing } from "../../hooks/usePlaybackBarSpacing";
import { selectSpaceMediaEvents } from "./spaceSelectors";
import { EVENT_KINDS } from "../../types/nostr";
import type { NostrEvent } from "../../types/nostr";
import { EnhancedVideoPlayer } from "../media/EnhancedVideoPlayer";
import { parseVideoEvent, selectVideoSource } from "../media/imetaParser";
import { Avatar } from "../../components/ui/Avatar";
import { RichContent } from "../../components/content/RichContent";
import { useProfile } from "../profile/useProfile";
import { extractMediaUrls, stripMediaUrls } from "../../lib/media/mediaUrlParser";
import { matchEmbed, type EmbedMatch, type EmbedPlatform } from "../../lib/content/embedPatterns";
import { imageCache } from "../../lib/cache/imageCache";
import { useScrollRestore } from "../../hooks/useScrollRestore";
import { useVideoThumbnail } from "../../hooks/useVideoThumbnail";
import { useFeedPagination } from "./useFeedPagination";
import { FeedToolbar } from "./FeedToolbar";
import { LoadMoreButton } from "./LoadMoreButton";

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
    <div className="flex flex-col overflow-hidden rounded-lg border border-edge bg-surface">
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

const VideoThumbnail = memo(function VideoThumbnail({
  item,
  onClick,
}: {
  item: MediaItem;
  onClick: () => void;
}) {
  const thumb = useVideoThumbnail(item.url, item.thumbnailUrl);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-edge bg-surface">
      <button
        onClick={onClick}
        className="group relative w-full shrink-0"
      >
        <div className="aspect-square w-full bg-surface">
          {thumb ? (
            <img
              src={thumb}
              alt={item.title ?? "Video"}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-surface">
              <Play size={32} className="text-muted" />
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
    <div className="flex flex-col overflow-hidden rounded-lg border border-edge bg-surface">
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
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0a0a1a]">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2">
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
          <div className="flex w-full max-w-3xl flex-col items-center justify-center rounded-lg border border-edge bg-surface p-8">
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
          <div className="mt-4 w-full max-w-3xl rounded-lg border border-edge bg-surface p-4">
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
  const authorName =
    profile?.display_name ||
    profile?.name ||
    item.event.pubkey.slice(0, 8) + "...";
  const text = getItemText(item);

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto bg-black p-4">
      <div className="w-full max-w-4xl">
        <EnhancedVideoPlayer
          src={item.url}
          poster={item.thumbnailUrl}
          title={item.title ?? item.caption}
          authorName={authorName}
          onClose={onClose}
          className="aspect-video w-full"
        />
      </div>
      {text && (
        <div className="mt-4 w-full max-w-4xl rounded-lg border border-edge bg-surface p-4">
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
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0a0a1a]">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2">
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-soft hover:bg-surface-hover hover:text-heading"
        >
          Back
        </button>
        <div className="flex-1" />
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
        <div className="border-t border-edge px-4 py-3">
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
          ? "bg-pulse/15 text-pulse-soft"
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
  const scrollRef = useScrollRestore(activeChannelId);
  const { meta, refresh, loadMore } = useFeedPagination("media");
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

  // Preload all image thumbnails into cache (including YouTube thumbs)
  useEffect(() => {
    const imageUrls = allItems
      .filter((m) => m.type === "image")
      .map((m) => m.url);
    const thumbUrls = allItems
      .filter((m) => m.thumbnailUrl)
      .map((m) => m.thumbnailUrl!);
    const ytThumbs = allItems
      .filter((m) => m.type === "embed" && m.embed?.platform === "youtube")
      .map((m) => YOUTUBE_THUMB_URL(m.embed!.id));
    imageCache.preloadMany([...imageUrls, ...thumbUrls, ...ytThumbs]);
  }, [allItems]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return allItems;
    if (filter === "images") return allItems.filter((m) => m.type === "image");
    if (filter === "videos") return allItems.filter((m) => m.type === "video");
    return allItems.filter((m) => m.type === "embed");
  }, [allItems, filter]);

  const imageCount = allItems.filter((m) => m.type === "image").length;
  const videoCount = allItems.filter((m) => m.type === "video").length;
  const embedCount = allItems.filter((m) => m.type === "embed").length;

  // Expanded view
  if (activeItem) {
    if (activeItem.type === "embed") {
      return (
        <ExpandedEmbedView
          item={activeItem}
          onClose={() => setActiveItem(null)}
        />
      );
    }
    if (activeItem.type === "video") {
      return (
        <ExpandedVideoView
          item={activeItem}
          onClose={() => setActiveItem(null)}
        />
      );
    }
    return (
      <ExpandedImageView
        item={activeItem}
        onClose={() => setActiveItem(null)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
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
              {filteredItems.map((item) => {
                if (item.type === "embed") {
                  return (
                    <EmbedThumbnail
                      key={item.key}
                      item={item}
                      onClick={() => setActiveItem(item)}
                    />
                  );
                }
                if (item.type === "video") {
                  return (
                    <VideoThumbnail
                      key={item.key}
                      item={item}
                      onClick={() => setActiveItem(item)}
                    />
                  );
                }
                return (
                  <ImageThumbnail
                    key={item.key}
                    item={item}
                    onClick={() => setActiveItem(item)}
                  />
                );
              })}
            </div>
            <LoadMoreButton
              isLoading={meta.isLoadingMore}
              hasMore={meta.hasMore}
              onLoadMore={loadMore}
            />
          </>
        )}
      </div>
    </div>
  );
}
