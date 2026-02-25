import { useState, useMemo, useEffect, useCallback, memo } from "react";
import { ChevronDown, ChevronUp, ImageIcon, Film } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { selectSpaceRootNotes, selectSpaceRootNoteIds } from "./spaceSelectors";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import {
  extractMediaUrls,
  stripMediaUrls,
  type ExtractedMedia,
} from "../../lib/media/mediaUrlParser";
import { imageCache } from "../../lib/cache/imageCache";
import { useScrollRestore } from "../../hooks/useScrollRestore";
import { useFeedPagination } from "./useFeedPagination";
import { FeedToolbar } from "./FeedToolbar";
import { LoadMoreButton } from "./LoadMoreButton";
import { useNoteEngagement } from "./useNoteEngagement";
import { useNoteActions } from "./useNoteActions";
import { useNoteEngagementSub } from "./useNoteEngagementSub";
import { parseQuoteRef } from "./noteParser";
import { NoteActionBar } from "./notes/NoteActionBar";
import { QuotedNote } from "./notes/QuotedNote";
import { ReplyComposer } from "./notes/ReplyComposer";
import { ThreadView } from "./notes/ThreadView";
import type { NostrEvent } from "../../types/nostr";

function InlineImage({ url }: { url: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-neon underline"
      >
        {url}
      </a>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="max-h-80 rounded-md object-contain"
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

function InlineVideo({ url }: { url: string }) {
  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className="max-h-80 rounded-md bg-black"
    />
  );
}

function MediaPreview({ media }: { media: ExtractedMedia[] }) {
  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((m) => (
            <InlineImage key={m.url} url={m.url} />
          ))}
        </div>
      )}
      {videos.map((m) => (
        <InlineVideo key={m.url} url={m.url} />
      ))}
    </div>
  );
}

const NoteCard = memo(function NoteCard({ event }: { event: NostrEvent }) {
  const { profile } = useProfile(event.pubkey);
  const [showMedia, setShowMedia] = useState(false);
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [threadExpanded, setThreadExpanded] = useState(false);

  const engagement = useNoteEngagement(event.id);
  const actions = useNoteActions(event);

  const quoteRef = useMemo(() => parseQuoteRef(event), [event]);

  const name =
    profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const date = new Date(event.created_at * 1000);
  const timeStr = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const { cleanText, media } = useMemo(() => {
    const extracted = extractMediaUrls(event.content);
    return {
      cleanText:
        extracted.length > 0
          ? stripMediaUrls(event.content)
          : event.content,
      media: extracted,
    };
  }, [event.content]);

  useEffect(() => {
    const imageUrls = media
      .filter((m) => m.type === "image")
      .map((m) => m.url);
    if (imageUrls.length > 0) {
      imageCache.preloadMany(imageUrls);
    }
  }, [media]);

  const imageCount = media.filter((m) => m.type === "image").length;
  const videoCount = media.filter((m) => m.type === "video").length;

  const handleReply = useCallback(() => {
    setShowReplyComposer((v) => !v);
  }, []);

  const handleRepost = useCallback(() => {
    actions.repost();
  }, [actions]);

  const handleLike = useCallback(() => {
    actions.like();
  }, [actions]);

  const handleQuote = useCallback(() => {
    // For now, toggle reply composer -- future: dedicated quote modal
    setShowReplyComposer((v) => !v);
  }, []);

  const handleSendReply = useCallback(
    (content: string) => {
      actions.reply(content);
      setShowReplyComposer(false);
    },
    [actions],
  );

  const handleCancelReply = useCallback(() => {
    setShowReplyComposer(false);
  }, []);

  const handleToggleThread = useCallback(() => {
    setThreadExpanded((v) => !v);
  }, []);

  return (
    <div className="rounded-lg border-neon-glow bg-card p-4 hover-lift transition-all duration-150 hover:glow-neon">
      <div className="mb-2 flex items-center gap-2">
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <span className="text-sm font-medium text-heading">{name}</span>
        <span className="text-xs text-muted">{timeStr}</span>
      </div>

      {cleanText && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-body">
          {cleanText}
        </p>
      )}

      {quoteRef && <QuotedNote eventId={quoteRef.eventId} />}

      {media.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowMedia((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-card-hover/60 px-2.5 py-1 text-xs text-soft transition-colors hover:bg-card-hover hover:text-heading"
          >
            {showMedia ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            )}
            {imageCount > 0 && (
              <span className="flex items-center gap-0.5">
                <ImageIcon size={12} /> {imageCount}
              </span>
            )}
            {videoCount > 0 && (
              <span className="flex items-center gap-0.5">
                <Film size={12} /> {videoCount}
              </span>
            )}
            <span>{showMedia ? "Hide media" : "Show media"}</span>
          </button>

          {showMedia && <MediaPreview media={media} />}
        </div>
      )}

      <NoteActionBar
        engagement={engagement}
        canInteract={actions.canInteract}
        canWrite={actions.canWrite}
        onReply={handleReply}
        onRepost={handleRepost}
        onLike={handleLike}
        onQuote={handleQuote}
      />

      {showReplyComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          onSend={handleSendReply}
          onCancel={handleCancelReply}
        />
      )}

      {engagement.replyCount > 0 && (
        <ThreadView
          eventId={event.id}
          expanded={threadExpanded}
          onToggle={handleToggleThread}
        />
      )}
    </div>
  );
});

export function NotesFeed() {
  const notes = useAppSelector(selectSpaceRootNotes);
  const noteIds = useAppSelector(selectSpaceRootNoteIds);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpace = useAppSelector((s) => {
    const id = s.spaces.activeSpaceId;
    return id ? s.spaces.list.find((sp) => sp.id === id) : undefined;
  });
  const scrollRef = useScrollRestore(activeChannelId);
  const { meta, refresh, loadMore } = useFeedPagination("notes");

  useNoteEngagementSub(noteIds, activeSpace?.hostRelay);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <FeedToolbar isRefreshing={meta.isRefreshing} onRefresh={refresh} />
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {notes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              No notes yet from space members
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((event) => (
              <NoteCard key={event.id} event={event} />
            ))}
            <LoadMoreButton
              isLoading={meta.isLoadingMore}
              hasMore={meta.hasMore}
              onLoadMore={loadMore}
            />
          </div>
        )}
      </div>
    </div>
  );
}
