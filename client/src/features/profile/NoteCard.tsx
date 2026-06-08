import { useState, useEffect, useMemo, useRef, memo, useCallback } from "react";
import { ChevronUp, ChevronDown, Image as ImageIcon, CornerUpLeft, MoreHorizontal, Trash2 } from "lucide-react";
import { MediaGallery } from "../../components/media";
import { Avatar } from "../../components/ui/Avatar";
import { RichContent } from "../../components/content/RichContent";
import { MusicEmbedCard } from "../../components/content/MusicEmbedCard";
import { NoteActionBar } from "../spaces/notes/NoteActionBar";
import { selectFeatureEnabled, FEATURE_AI } from "../../store/slices/featuresSlice";
import { useAskAI } from "../ai/context/useAskAI";
import { buildThreadContext, buildNoteContext } from "../ai/context/aiContext";
import { QuotedNote } from "../spaces/notes/QuotedNote";
import { ReplyComposer } from "../spaces/notes/ReplyComposer";
import { RepostHeader } from "./RepostHeader";
import { useProfile } from "./useProfile";
import { useProfileNoteActions } from "./useProfileNoteActions";
import { useNoteEngagement } from "../spaces/useNoteEngagement";
import { useRepostedEvent } from "./useRepostedEvent";
import { useEngagementReporter, EngagementCollectorProvider } from "./engagementCollector";
import { parseThreadRef, parseQuoteRef, isDirectReply } from "../spaces/noteParser";
import { extractMediaUrls, stripMediaUrls } from "../../lib/media/mediaUrlParser";
import { UserPopoverCard } from "./UserPopoverCard";
import { useZap } from "../wallet/WalletProvider";
import { useClickOutside } from "../../hooks/useClickOutside";
import { shallowEqual } from "react-redux";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { eventsSelectors, removeEvent, removeRepost } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "../../lib/nostr/constants";
import { buildDeletionEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { deleteEvent as deleteEventFromDB } from "../../lib/db/eventStore";
import { EVENT_KINDS, type NostrEvent } from "../../types/nostr";
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
  /** Feed position — used to fetch engagement in document order */
  index?: number;
  /** Show "View thread" context for replies */
  showThreadContext?: boolean;
  /** Stagger animation delay in ms */
  animationDelay?: number;
  /**
   * Stable id for anchor-based scroll restoration. Set by paginated feeds (not
   * pinned/standalone uses) so back-nav can land on this exact card.
   */
  anchorId?: string;
}

export const ProfileNoteCard = memo(function ProfileNoteCard({
  item,
  index = 0,
  showThreadContext,
  animationDelay,
  anchorId,
}: NoteCardProps) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const dispatch = useAppDispatch();

  const handleUnrepost = useCallback(async () => {
    if (!myPubkey || !item.reposterPubkey) return;
    // Only allow unreposting own reposts
    if (item.reposterPubkey !== myPubkey) return;
    const repostEventId = item.event.id;
    // Optimistic removal from Redux + IndexedDB
    dispatch(removeEvent(repostEventId));
    dispatch(removeRepost({ pubkey: myPubkey, eventId: repostEventId }));
    deleteEventFromDB(repostEventId).catch(() => {});
    // Publish kind:5 deletion targeting the kind:6 repost
    const unsigned = buildDeletionEvent(
      myPubkey,
      { eventIds: [repostEventId] },
      undefined,
      ["6"],
    );
    await signAndPublish(unsigned);
  }, [myPubkey, item.event.id, item.reposterPubkey, dispatch]);

  // Fetch engagement for this card when it scrolls into view (see collector).
  const engagementRef = useEngagementReporter(item.event.id, index);

  if (item.repostedEventId) {
    const isOwnRepost = item.reposterPubkey === myPubkey;
    return (
      <div
        ref={engagementRef}
        data-feed-anchor={anchorId}
        className="animate-fade-in-up"
        style={animationDelay ? { animationDelay: `${animationDelay}ms` } : undefined}
      >
        <RepostHeader
          pubkey={item.reposterPubkey!}
          onUnrepost={isOwnRepost ? handleUnrepost : undefined}
        />
        <RepostedNoteInner repostEvent={item.event} />
      </div>
    );
  }

  return (
    <div
      ref={engagementRef}
      data-feed-anchor={anchorId}
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

  // Music event reposts: render as MusicEmbedCard instead of NoteCardInner
  if (
    originalEvent.kind === EVENT_KINDS.MUSIC_TRACK ||
    originalEvent.kind === EVENT_KINDS.MUSIC_ALBUM
  ) {
    const dTag = originalEvent.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return (
      <div className="card-glass rounded-xl p-5">
        <MusicEmbedCard
          kind={originalEvent.kind}
          pubkey={originalEvent.pubkey}
          identifier={dTag}
        />
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
  const { openZap } = useZap();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const pinnedNoteIds = useAppSelector((s) => s.identity.pinnedNoteIds);
  const askAI = useAskAI();
  const aiEnabled = useAppSelector(selectFeatureEnabled(FEATURE_AI));
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [showQuoteComposer, setShowQuoteComposer] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [showMedia, setShowMedia] = useState(true);
  const [showPopover, setShowPopover] = useState(false);
  const [mentionPopover, setMentionPopover] = useState<{ pubkey: string; anchor: HTMLElement } | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const deleteConfirmRef = useRef<HTMLDivElement>(null);

  useClickOutside(overflowRef, () => setShowOverflow(false), showOverflow);
  useClickOutside(deleteConfirmRef, () => setShowDeleteConfirm(false), showDeleteConfirm);

  const handleDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setShowOverflow(false);
    actions.deleteNote(event.id);
  }, [actions, event.id]);

  // Pin detection: only show on own root notes (kind:1 with no reply)
  const isOwnNote = event.pubkey === myPubkey;
  const isRootNote = useMemo(() => parseThreadRef(event).rootId === null, [event]);
  const showPin = isOwnNote && isRootNote;
  const isPinned = pinnedNoteIds.includes(event.id);

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
    <div className="group/notecard card-glass rounded-xl p-5 transition-all duration-150">
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
          <span
            className="ml-2 text-xs text-muted"
            title={new Date(event.created_at * 1000).toLocaleString()}
          >
            {formatRelativeTime(event.created_at)}
          </span>
        </div>

        {/* Overflow menu (own notes only) */}
        {isOwnNote && (
          <div className="relative" ref={overflowRef}>
            <button
              onClick={() => setShowOverflow((v) => !v)}
              className="rounded-lg p-1 text-muted opacity-0 group-hover/notecard:opacity-100 hover:text-heading hover:bg-surface-hover transition-all"
            >
              <MoreHorizontal size={16} />
            </button>

            {showOverflow && (
              <div
                className="absolute right-0 top-full mt-1 z-50 w-40 rounded-lg border border-border-light overflow-hidden"
                style={{
                  backgroundColor: "var(--color-card)",
                  boxShadow: "var(--shadow-elevated)",
                }}
              >
                <button
                  onClick={() => {
                    setShowOverflow(false);
                    setShowDeleteConfirm(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={13} />
                  Delete Note
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div
          ref={deleteConfirmRef}
          className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3"
        >
          <p className="text-xs text-heading font-medium mb-1">
            Delete this note?
          </p>
          <p className="text-[11px] text-muted mb-3">
            This will broadcast a deletion request to all relays. Some relays may still retain the original event.
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-md px-2.5 py-1 text-xs text-soft hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              className="rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Thread context for replies — clickable to show parent */}
      {showThreadContext && threadRef.replyId && (
        <ThreadContext parentId={threadRef.replyId} />
      )}

      {/* Content — mentions open an in-place popover, never navigate away */}
      {cleanedContent && (
        <div className="text-sm leading-relaxed text-body">
          <RichContent
            content={cleanedContent}
            onMentionClick={(pubkey, anchor) => setMentionPopover({ pubkey, anchor })}
            suppressEventIds={quoteRef ? [quoteRef.eventId] : undefined}
          />
        </div>
      )}
      {mentionPopover && (
        <UserPopoverCard
          pubkey={mentionPopover.pubkey}
          anchorEl={mentionPopover.anchor}
          onClose={() => setMentionPopover(null)}
        />
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

      {/* Keep the gallery mounted and toggle visibility so re-showing doesn't
          re-decode the media and pop in at the wrong size. */}
      {media.length > 0 && (
        <div className={showMedia ? undefined : "hidden"}>
          <MediaGallery media={media} density="feed" />
        </div>
      )}

      {/* Quoted note */}
      {quoteRef && (
        <QuotedNote eventId={quoteRef.eventId} relayHint={quoteRef.relayHint} pubkey={quoteRef.pubkey} />
      )}

      {/* Engagement action bar */}
      <NoteActionBar
        engagement={engagement}
        canInteract={actions.canInteract}
        canWrite={actions.canWrite}
        onReply={() => setShowReplyComposer((v) => !v)}
        onRepost={actions.repost}
        onLike={actions.like}
        onQuote={() => setShowQuoteComposer((v) => !v)}
        onZap={() => openZap({ recipientPubkey: event.pubkey, event })}
        showPin={showPin}
        isPinned={isPinned}
        onPin={() => actions.togglePin(event.id)}
        onAskAI={
          aiEnabled
            ? () => askAI(buildThreadContext(event.id) ?? buildNoteContext(event.id))
            : undefined
        }
      />

      {/* Reply composer */}
      {showReplyComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          onSend={(content) => {
            actions.reply(content);
            setShowReplyComposer(false);
            setShowReplies(true);
          }}
          onCancel={() => setShowReplyComposer(false)}
        />
      )}

      {/* Quote composer — replaces the old native prompt() */}
      {showQuoteComposer && (
        <ReplyComposer
          targetPubkey={event.pubkey}
          label="Quoting"
          placeholder="Add a comment…"
          onSend={(content) => {
            actions.quote(content);
            setShowQuoteComposer(false);
          }}
          onCancel={() => setShowQuoteComposer(false)}
        />
      )}

      {/* Inline replies — read the conversation without leaving the feed */}
      {engagement.replyCount > 0 && (
        <button
          onClick={() => setShowReplies((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-muted transition-colors hover:text-heading"
        >
          {showReplies ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showReplies ? "Hide" : "View"} {engagement.replyCount}{" "}
          {engagement.replyCount === 1 ? "reply" : "replies"}
        </button>
      )}
      {showReplies && <InlineReplies noteId={event.id} />}
    </div>
  );
}

/** Stable empty array so the id selector doesn't churn when there are none. */
const EMPTY_IDS: string[] = [];

/**
 * Lazily-loaded reply thread, rendered inline so the conversation is reachable
 * without navigating to a dedicated note page. Subscribes for direct replies
 * (kind:1 `#e`) while expanded and renders each as a (recursively expandable)
 * note card, so likes/zaps/replies and nested threads all work in place.
 */
function InlineReplies({ noteId }: { noteId: string }) {
  // Select the (stable) id list and the entities map separately, then derive the
  // direct-child set in a memo — so we don't rebuild + sort on every unrelated
  // store dispatch (engagement REQs stream kind:7/6/1 constantly).
  const replyIds = useAppSelector(
    (s) => s.events.replies[noteId] ?? EMPTY_IDS,
    shallowEqual,
  );
  const entities = useAppSelector((s) => s.events.entities);

  const items = useMemo(() => {
    const out: ProfileFeedItem[] = [];
    for (const id of replyIds) {
      const ev = entities[id];
      // DIRECT replies only: `replies[noteId]` is the whole flattened subtree
      // (each reply is indexed under both its root and its parent), so without
      // this filter every nested reply would also render under each ancestor.
      if (ev && isDirectReply(ev, noteId)) {
        out.push({ event: ev, repostedEventId: null, reposterPubkey: null });
      }
    }
    out.sort((a, b) => a.event.created_at - b.event.created_at);
    return out;
  }, [replyIds, entities, noteId]);

  // Fetch the full thread + stream new replies for as long as it's open.
  useEffect(() => {
    const subId = subscriptionManager.subscribe({
      filters: [{ kinds: [EVENT_KINDS.SHORT_TEXT], "#e": [noteId], limit: 100 }],
      relayUrls: PROFILE_RELAYS,
    });
    return () => subscriptionManager.close(subId);
  }, [noteId]);

  if (items.length === 0) {
    return <p className="mt-2 pl-3 text-xs text-muted">Loading replies…</p>;
  }

  return (
    // Stable item identities (memoized above) keep ProfileNoteCard's memo intact.
    <div className="mt-3 flex flex-col gap-3 border-l-2 border-border pl-3">
      <EngagementCollectorProvider relayUrls={PROFILE_RELAYS}>
        {items.map((item, i) => (
          <ProfileNoteCard key={item.event.id} item={item} index={i} />
        ))}
      </EngagementCollectorProvider>
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
      relayUrls: PROFILE_RELAYS,
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
    <div className="mb-3 rounded-xl border border-border bg-surface p-3">
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
