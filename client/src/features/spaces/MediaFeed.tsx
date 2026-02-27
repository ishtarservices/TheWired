import { useState, useMemo, useEffect, memo } from "react";
import { Play, ImageIcon, Maximize2 } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { selectSpaceMediaEvents } from "./spaceSelectors";
import { EVENT_KINDS } from "../../types/nostr";
import type { NostrEvent } from "../../types/nostr";
import { EnhancedVideoPlayer } from "../media/EnhancedVideoPlayer";
import { parseVideoEvent, selectVideoSource } from "../media/imetaParser";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { extractMediaUrls, stripMediaUrls } from "../../lib/media/mediaUrlParser";
import { imageCache } from "../../lib/cache/imageCache";
import { useScrollRestore } from "../../hooks/useScrollRestore";
import { useVideoThumbnail } from "../../hooks/useVideoThumbnail";
import { useFeedPagination } from "./useFeedPagination";
import { FeedToolbar } from "./FeedToolbar";
import { LoadMoreButton } from "./LoadMoreButton";

// ── Types ────────────────────────────────────────────────────────

type MediaItemType = "image" | "video";

interface MediaItem {
  key: string;
  type: MediaItemType;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  event: NostrEvent;
  caption?: string;
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
    const extracted = extractMediaUrls(event.content);
    if (extracted.length === 0) return [];
    const caption = stripMediaUrls(event.content);
    return extracted.map((m, i) => ({
      key: `${event.id}:${i}`,
      type: m.type === "video" ? "video" as const : "image" as const,
      url: m.url,
      caption: caption || undefined,
      event,
    }));
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
    <div className="flex flex-col overflow-hidden rounded-lg border border-white/[0.04] bg-white/[0.02]">
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
    <div className="flex flex-col overflow-hidden rounded-lg border border-white/[0.04] bg-white/[0.02]">
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
        <div className="mt-4 w-full max-w-4xl rounded-lg border border-white/[0.04] bg-white/[0.02] p-4">
          <AuthorBadge pubkey={item.event.pubkey} />
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-body">
            {text}
          </p>
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
      <div className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2">
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-soft hover:bg-white/[0.04] hover:text-heading"
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
        <div className="border-t border-white/[0.04] px-4 py-3">
          <p className="whitespace-pre-wrap text-sm text-soft">{text}</p>
        </div>
      )}
    </div>
  );
}

// ── Filter tabs ──────────────────────────────────────────────────

type FilterTab = "all" | "images" | "videos";

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
          : "text-soft hover:bg-white/[0.04] hover:text-heading"
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

  // Preload all image thumbnails into cache
  useEffect(() => {
    const imageUrls = allItems
      .filter((m) => m.type === "image")
      .map((m) => m.url);
    const thumbUrls = allItems
      .filter((m) => m.thumbnailUrl)
      .map((m) => m.thumbnailUrl!);
    imageCache.preloadMany([...imageUrls, ...thumbUrls]);
  }, [allItems]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return allItems;
    if (filter === "images") return allItems.filter((m) => m.type === "image");
    return allItems.filter((m) => m.type === "video");
  }, [allItems, filter]);

  const imageCount = allItems.filter((m) => m.type === "image").length;
  const videoCount = allItems.filter((m) => m.type === "video").length;

  // Expanded view
  if (activeItem) {
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
          </>
        )}
      </FeedToolbar>

      {/* Grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {filteredItems.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              No media yet from space members
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {filteredItems.map((item) =>
                item.type === "video" ? (
                  <VideoThumbnail
                    key={item.key}
                    item={item}
                    onClick={() => setActiveItem(item)}
                  />
                ) : (
                  <ImageThumbnail
                    key={item.key}
                    item={item}
                    onClick={() => setActiveItem(item)}
                  />
                ),
              )}
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
