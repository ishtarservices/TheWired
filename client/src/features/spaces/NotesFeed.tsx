import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
import { nip19 } from "nostr-tools";
import { ChevronDown, ChevronUp, ImageIcon, Film, Gauge } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { usePlaybackBarSpacing } from "../../hooks/usePlaybackBarSpacing";
import { selectSpaceRootNotes, selectSpaceRootNoteIds, selectActiveSpace } from "./spaceSelectors";
import { Avatar } from "../../components/ui/Avatar";
import { RichContent } from "../../components/content/RichContent";
import { useProfile } from "../profile/useProfile";
import { useUserPopover } from "../profile/UserPopoverContext";
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
import { useIsBlocked } from "../../hooks/useIsBlocked";
import { useUnblock } from "../../hooks/useUnblock";
import { BlockedMessage } from "../../components/ui/BlockedMessage";
import { usePlaybackSpeed, VALID_SPEEDS } from "@/hooks/usePlaybackSpeed";
import { NoteActionBar } from "./notes/NoteActionBar";
import { QuotedNote } from "./notes/QuotedNote";
import { ReplyComposer } from "./notes/ReplyComposer";
import { ThreadView } from "./notes/ThreadView";
import { RecipientPickerModal } from "../../components/sharing/RecipientPickerModal";
import { sendDM } from "../dm/dmService";
import type { NostrEvent } from "../../types/nostr";

function InlineImage({ url }: { url: string }) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-primary underline"
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = usePlaybackSpeed();
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  return (
    <div className="group/video relative inline-block max-h-80">
      <video
        ref={videoRef}
        src={url}
        controls
        playsInline
        preload="metadata"
        className="max-h-80 rounded-md bg-black"
        onRateChange={(e) => {
          // Sync if user changes speed via native controls
          const rate = (e.target as HTMLVideoElement).playbackRate;
          if (rate !== playbackRate) setPlaybackRate(rate);
        }}
      />
      {/* Speed overlay button */}
      <div className="absolute right-2 top-2 z-10">
        <button
          onClick={() => setShowSpeedMenu((v) => !v)}
          className={`flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm transition-colors ${
            playbackRate !== 1
              ? "bg-indigo-500/20 text-indigo-300"
              : "bg-black/50 text-white/70 opacity-0 group-hover/video:opacity-100"
          }`}
          title="Playback speed"
        >
          <Gauge size={12} />
          <span>{playbackRate}x</span>
        </button>
        {showSpeedMenu && (
          <div className="absolute right-0 top-full mt-1 rounded-xl border border-border card-glass py-1 shadow-lg">
            {VALID_SPEEDS.map((speed) => (
              <button
                key={speed}
                onClick={() => { setPlaybackRate(speed); setShowSpeedMenu(false); }}
                className={`block w-full px-3 py-1 text-left text-xs transition-colors ${
                  speed === playbackRate
                    ? "bg-primary/15 text-primary-soft"
                    : "text-body hover:bg-surface-hover"
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
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
  const isBlocked = useIsBlocked(event.pubkey);
  const { openUserPopover } = useUserPopover();
  const [showMedia, setShowMedia] = useState(false);
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);

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

  const handleShare = useCallback(() => {
    setSharePickerOpen(true);
  }, []);

  const handleShareToDM = useCallback(
    async (recipientPubkey: string) => {
      const nevent = nip19.neventEncode({ id: event.id });
      await sendDM(recipientPubkey, `nostr:${nevent}`);
    },
    [event.id],
  );

  const unblock = useUnblock(event.pubkey);

  if (isBlocked) {
    return <BlockedMessage variant="note" onUnblock={unblock}><div /></BlockedMessage>;
  }

  return (
    <div className="rounded-lg border-primary-glow bg-card p-4 hover-lift transition-all duration-150 hover:glow-primary">
      <div className="mb-2 flex items-center gap-2">
        <button
          ref={avatarRef}
          type="button"
          onClick={() => {
            if (avatarRef.current) openUserPopover(event.pubkey, avatarRef.current);
          }}
          className="cursor-pointer"
        >
          <Avatar src={profile?.picture} alt={name} size="sm" />
        </button>
        <span className="text-sm font-medium text-heading">{name}</span>
        <span className="text-xs text-muted">{timeStr}</span>
      </div>

      {cleanText && (
        <div className="text-sm leading-relaxed text-body">
          <RichContent content={cleanText} onMentionClick={openUserPopover} />
        </div>
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
        onShare={handleShare}
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

      {sharePickerOpen && (
        <RecipientPickerModal
          open={sharePickerOpen}
          onClose={() => setSharePickerOpen(false)}
          onSelect={handleShareToDM}
          title="Forward Note"
        />
      )}
    </div>
  );
});

export function NotesFeed() {
  const notes = useAppSelector(selectSpaceRootNotes);
  const noteIds = useAppSelector(selectSpaceRootNoteIds);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpace = useAppSelector(selectActiveSpace);
  const scrollRef = useScrollRestore(activeChannelId);
  const { meta, refresh, loadMore } = useFeedPagination("notes");
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  useNoteEngagementSub(noteIds, activeSpace?.hostRelay);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <FeedToolbar isRefreshing={meta.isRefreshing} onRefresh={refresh} />
      <div ref={scrollRef} className={`flex-1 overflow-y-auto p-5 ${scrollPaddingClass}`}>
        {notes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              {activeSpace?.mode === "read"
                ? "No notes yet -- add feed sources to see content here"
                : "No notes yet from space members"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {notes.map((event, index) => (
              <div
                key={event.id}
                className={index < 15 ? "animate-fade-in-up" : undefined}
                style={index < 15 ? { animationDelay: `${index * 50}ms` } : undefined}
              >
                <NoteCard event={event} />
              </div>
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
