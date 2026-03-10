import { useState, useEffect, useMemo, useRef, memo } from "react";
import { ChevronUp, ChevronDown, Image as ImageIcon, CornerUpLeft } from "lucide-react";
import { MediaLightbox } from "../../components/ui/MediaLightbox";
import { Avatar } from "../../components/ui/Avatar";
import { RichContent } from "../../components/content/RichContent";
import { NoteActionBar } from "../spaces/notes/NoteActionBar";
import { QuotedNote } from "../spaces/notes/QuotedNote";
import { ReplyComposer } from "../spaces/notes/ReplyComposer";
import { RepostHeader } from "./RepostHeader";
import { useProfile } from "./useProfile";
import { useProfileNoteActions } from "./useProfileNoteActions";
import { useNoteEngagement } from "../spaces/useNoteEngagement";
import { useRepostedEvent } from "./useRepostedEvent";
import { parseThreadRef, parseQuoteRef } from "../spaces/noteParser";
import { extractMediaUrls, stripMediaUrls } from "../../lib/media/mediaUrlParser";
import { UserPopoverCard } from "./UserPopoverCard";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import type { NostrEvent } from "../../types/nostr";
import type { ProfileFeedItem } from "./useProfileNotes";

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

interface NoteCardProps {
  item: ProfileFeedItem;
  /** Show "View thread" context for replies */
  showThreadContext?: boolean;
  /** Stagger animation delay in ms */
  animationDelay?: number;
}

export const ProfileNoteCard = memo(function ProfileNoteCard({
  item,
  showThreadContext,
  animationDelay,
}: NoteCardProps) {
  if (item.repostedEventId) {
    return (
      <div
        className="animate-fade-in-up"
        style={animationDelay ? { animationDelay: `${animationDelay}ms` } : undefined}
      >
        <RepostHeader pubkey={item.reposterPubkey!} />
        <RepostedNoteInner repostEvent={item.event} />
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in-up"
      style={animationDelay ? { animationDelay: `${animationDelay}ms` } : undefined}
    >
      <NoteCardInner
        event={item.event}
        showThreadContext={showThreadContext}
      />
    </div>
  );
});

/** Renders the inner content of a repost by resolving the original event */
function RepostedNoteInner({ repostEvent }: { repostEvent: NostrEvent }) {
  const originalEvent = useRepostedEvent(repostEvent);

  if (!originalEvent) {
    return (
      <div className="card-glass rounded-xl p-5 text-sm text-muted">
        Loading reposted note...
      </div>
    );
  }

  return <NoteCardInner event={originalEvent} />;
}

/** The core note card with author info, media, engagement, etc. */
function NoteCardInner({
  event,
  showThreadContext,
}: {
  event: NostrEvent;
  showThreadContext?: boolean;
}) {
  const { profile } = useProfile(event.pubkey);
  const engagement = useNoteEngagement(event.id);
  const actions = useProfileNoteActions(event);
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [showMedia, setShowMedia] = useState(true);
  const [showPopover, setShowPopover] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  const displayName = profile?.display_name || profile?.name || event.pubkey.slice(0, 12) + "...";

  // Parse thread refs
  const threadRef = useMemo(() => parseThreadRef(event), [event]);
  const quoteRef = useMemo(() => parseQuoteRef(event), [event]);

  // Extract media
  const media = useMemo(() => extractMediaUrls(event.content), [event.content]);
  const cleanedContent = useMemo(
    () => media.length > 0 ? stripMediaUrls(event.content) : event.content,
    [event.content, media],
  );

  const hasMedia = media.length > 0;

  return (
    <div className="card-glass rounded-xl p-5 transition-all duration-150 hover-lift">
      {/* Author row */}
      <div className="mb-3 flex items-center gap-3">
        <button
          ref={avatarRef}
          onClick={() => setShowPopover((v) => !v)}
          className="rounded-full shrink-0"
        >
          <Avatar src={profile?.picture} alt={displayName} size="sm" />
        </button>
        {showPopover && avatarRef.current && (
          <UserPopoverCard pubkey={event.pubkey} anchorEl={avatarRef.current} onClose={() => setShowPopover(false)} />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-heading">{displayName}</span>
          <span className="ml-2 text-xs text-muted">{formatRelativeTime(event.created_at)}</span>
        </div>
      </div>

      {/* Thread context for replies — clickable to show parent */}
      {showThreadContext && threadRef.replyId && (
        <ThreadContext parentId={threadRef.replyId} />
      )}

      {/* Content */}
      {cleanedContent && (
        <div className="text-sm leading-relaxed text-body">
          <RichContent content={cleanedContent} />
        </div>
      )}

      {/* Media toggle + display — shown by default */}
      {hasMedia && (
        <button
          onClick={() => setShowMedia((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs text-muted hover:text-heading transition-colors"
        >
          <ImageIcon size={13} />
          <span>{showMedia ? "Hide" : "Show"} media ({media.length})</span>
          {showMedia ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      )}

      {showMedia && media.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {media.map((m) => (
            <div key={m.url}>
              {m.type === "image" && (
                <img
                  src={m.url}
                  alt=""
                  loading="lazy"
                  onClick={() => setLightboxSrc(m.url)}
                  className="max-h-96 w-full rounded-lg object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                />
              )}
              {m.type === "video" && (
                <video
                  src={m.url}
                  controls
                  preload="metadata"
                  className="max-h-96 w-full rounded-lg"
                />
              )}
              {m.type === "audio" && (
                <audio src={m.url} controls className="w-full" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Image lightbox */}
      {lightboxSrc && (
        <MediaLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* Quoted note */}
      {quoteRef && <QuotedNote eventId={quoteRef.eventId} />}

      {/* Engagement action bar */}
      <NoteActionBar
        engagement={engagement}
        canInteract={actions.canInteract}
        canWrite={actions.canWrite}
        onReply={() => setShowReplyComposer((v) => !v)}
        onRepost={actions.repost}
        onLike={actions.like}
        onQuote={() => {
          // Quote is a more complex interaction — for now, same as repost
          // A full quote modal would be a future enhancement
          const content = prompt("Quote this note:");
          if (content) actions.quote(content);
        }}
      />

      {/* Reply composer */}
      {showReplyComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          onSend={(content) => {
            actions.reply(content);
            setShowReplyComposer(false);
          }}
          onCancel={() => setShowReplyComposer(false)}
        />
      )}
    </div>
  );
}

/** Shows the parent note a reply is responding to. Fetches if not in store. */
function ThreadContext({ parentId }: { parentId: string }) {
  const [expanded, setExpanded] = useState(false);
  const parentEvent = useAppSelector((s) => eventsSelectors.selectById(s.events, parentId));

  // Fetch parent event if not in store and user expands
  useEffect(() => {
    if (!expanded || parentEvent) return;

    const subId = subscriptionManager.subscribe({
      filters: [{ ids: [parentId] }],
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [expanded, parentEvent, parentId]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mb-2 flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-xs text-muted hover:text-heading hover:bg-surface-hover transition-colors w-full text-left"
      >
        <CornerUpLeft size={12} className="shrink-0" />
        <span>View parent post</span>
      </button>
    );
  }

  if (!parentEvent) {
    return (
      <div className="mb-2 rounded-lg bg-surface px-3 py-2 text-xs text-muted animate-pulse">
        Loading parent note...
      </div>
    );
  }

  return (
    <ParentNotePreview event={parentEvent} onCollapse={() => setExpanded(false)} />
  );
}

/** Compact preview of the parent note */
function ParentNotePreview({ event, onCollapse }: { event: NostrEvent; onCollapse: () => void }) {
  const { profile } = useProfile(event.pubkey);
  const name = profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const truncated = event.content.length > 280
    ? event.content.slice(0, 280) + "..."
    : event.content;

  return (
    <div className="mb-3 rounded-xl border border-edge bg-surface p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Avatar src={profile?.picture} alt={name} size="xs" />
          <span className="text-xs font-medium text-heading">{name}</span>
          <span className="text-xs text-muted">{formatRelativeTime(event.created_at)}</span>
        </div>
        <button
          onClick={onCollapse}
          className="text-xs text-muted hover:text-heading transition-colors"
        >
          Hide
        </button>
      </div>
      <div className="text-xs leading-relaxed text-body line-clamp-4">
        <RichContent content={truncated} />
      </div>
    </div>
  );
}

// Re-export for backward compat — old signature with just `event`
interface LegacyNoteCardProps {
  event: NostrEvent;
}

export function NoteCard({ event }: LegacyNoteCardProps) {
  const item: ProfileFeedItem = {
    event,
    repostedEventId: null,
    reposterPubkey: null,
  };
  return <ProfileNoteCard item={item} />;
}
