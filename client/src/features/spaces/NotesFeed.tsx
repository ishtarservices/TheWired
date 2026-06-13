import { useState, useMemo, useEffect, useCallback, useRef, memo } from "react";
import { ChevronDown, ChevronUp, ImageIcon, Film } from "lucide-react";
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
} from "../../lib/media/mediaUrlParser";
import { imageCache } from "../../lib/cache/imageCache";
import { MediaGallery } from "../../components/media";
import { useScrollRestore } from "../../hooks/useScrollRestore";
import { useFeedPagination } from "./useFeedPagination";
import { FeedToolbar } from "./FeedToolbar";
import { LoadMoreButton } from "./LoadMoreButton";
import { RevealSentinel } from "../../components/ui/RevealSentinel";
import { useNoteEngagementSub } from "./useNoteEngagementSub";
import { parseQuoteRef } from "./noteParser";
import { useIsBlocked } from "../../hooks/useIsBlocked";
import { useUnblock } from "../../hooks/useUnblock";
import { FRIENDS_FEED_ID } from "../friends/friendsFeedConstants";
import { BlockedMessage } from "../../components/ui/BlockedMessage";
import { QuotedNote } from "./notes/QuotedNote";
import { NoteFooter } from "./notes/NoteFooter";
import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import { MusicEmbedCard } from "../../components/content/MusicEmbedCard";
import { RepostHeader } from "../profile/RepostHeader";
import { useRepostedEvent } from "../profile/useRepostedEvent";
import { NoteComposer } from "../profile/NoteComposer";
import { PollNoteCard } from "../polls/PollNoteCard";
import {
  selectFriendsFeedNotes,
  selectFriendsFeedNoteIds,
  selectMutedPubkeySet,
  selectMutedWordList,
} from "../friends/friendsFeedSelectors";
import { selectHiddenPubkeySet } from "../../store/slices/feedPrefsSlice";
import { isEventVisibleInFeed } from "../friends/feedVisibility";
import { FeedPrefsButton } from "../friends/FeedPrefsButton";

/** How many cards to add to the rendered window each time the sentinel is hit. */
const RENDER_PAGE = 30;

const NoteCard = memo(function NoteCard({ event }: { event: NostrEvent }) {
  const { profile } = useProfile(event.pubkey);
  const isBlocked = useIsBlocked(event.pubkey);
  const { openUserPopover } = useUserPopover();
  const [showMedia, setShowMedia] = useState(true);
  const avatarRef = useRef<HTMLButtonElement>(null);

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
          <RichContent
            content={cleanText}
            onMentionClick={openUserPopover}
            suppressEventIds={quoteRef ? [quoteRef.eventId] : undefined}
          />
        </div>
      )}

      {quoteRef && (
        <QuotedNote eventId={quoteRef.eventId} relayHint={quoteRef.relayHint} pubkey={quoteRef.pubkey} />
      )}

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

          {/* Keep the gallery mounted and just toggle visibility — re-mounting
              on every Show would re-decode the media and pop in at the wrong
              size before settling. */}
          <div className={showMedia ? undefined : "hidden"}>
            <MediaGallery media={media} density="feed" />
          </div>
        </div>
      )}

      {/* Engagement counts, actions, replies, thread, share — isolated in a
          memoized subtree so the kind 7/6/1 event-storm (and interaction
          toggles) never re-render the text or media above. */}
      <NoteFooter event={event} />
    </div>
  );
});

/** Repost (kind:6) card: "Reposted by" header + the original note, resolved
 *  via useRepostedEvent (embedded JSON is schnorr-verified by the pipeline —
 *  never rendered directly). */
const RepostCard = memo(function RepostCard({ event }: { event: NostrEvent }) {
  const original = useRepostedEvent(event);
  const muted = useAppSelector(selectMutedPubkeySet);
  const hidden = useAppSelector(selectHiddenPubkeySet);
  const words = useAppSelector(selectMutedWordList);

  if (!original) {
    return (
      <div className="rounded-lg border-primary-glow bg-card p-4">
        <RepostHeader pubkey={event.pubkey} />
        <p className="text-sm text-muted">Loading reposted note...</p>
      </div>
    );
  }

  // The feed selector vets the reposter; the original resolves async, so its
  // author/content gets the same mute/hidden/word check here.
  if (!isEventVisibleInFeed(original, muted, hidden, words)) return null;

  if (
    original.kind === EVENT_KINDS.MUSIC_TRACK ||
    original.kind === EVENT_KINDS.MUSIC_ALBUM
  ) {
    const dTag = original.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return (
      <div>
        <RepostHeader pubkey={event.pubkey} />
        <div className="rounded-lg border-primary-glow bg-card p-4">
          <MusicEmbedCard
            kind={original.kind}
            pubkey={original.pubkey}
            identifier={dTag}
          />
        </div>
      </div>
    );
  }

  if (original.kind === EVENT_KINDS.POLL) {
    return (
      <div>
        <RepostHeader pubkey={event.pubkey} />
        <PollNoteCard event={original} />
      </div>
    );
  }

  return (
    <div>
      <RepostHeader pubkey={event.pubkey} />
      <NoteCard event={original} />
    </div>
  );
});

export function NotesFeed() {
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeSpace = useAppSelector(selectActiveSpace);
  const isFriendsFeed = activeSpaceId === FRIENDS_FEED_ID;
  // The Feed gets mute/hidden/word filtering + reply/repost prefs; spaces keep
  // the plain root-notes selectors. Selector identity only flips on space
  // switch, so the conditional is safe for memoization.
  const notes = useAppSelector(
    isFriendsFeed ? selectFriendsFeedNotes : selectSpaceRootNotes,
  );
  const noteIds = useAppSelector(
    isFriendsFeed ? selectFriendsFeedNoteIds : selectSpaceRootNoteIds,
  );
  const scrollRef = useScrollRestore(activeChannelId);
  const { meta, refresh, loadMore } = useFeedPagination("notes");
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  // Render-cap: mount only a window of cards and grow it as the user scrolls,
  // instead of mounting every fetched note (each card carries a profile sub,
  // media, and an engagement subtree). Mirrors MediaFeed.
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE);
  // Switching channel/space starts a fresh window.
  useEffect(() => {
    setRenderLimit(RENDER_PAGE);
  }, [activeChannelId, activeSpaceId]);
  const revealMore = useCallback(() => setRenderLimit((n) => n + RENDER_PAGE), []);

  const visibleNotes = useMemo(() => notes.slice(0, renderLimit), [notes, renderLimit]);
  const hasMoreLocal = renderLimit < notes.length;

  // For Friends Feed and read-only spaces, replies/reactions live on repliers' own relays,
  // not a single host relay — use all read relays (undefined).
  const engagementRelays =
    isFriendsFeed || activeSpace?.mode === "read"
      ? undefined
      : activeSpace?.hostRelay
        ? [activeSpace.hostRelay]
        : undefined;

  // Only subscribe to engagement for the rendered window — no point pulling
  // reactions for notes that aren't on screen yet. Grows with the window;
  // the sub itself still caps at BATCH_LIMIT and debounces.
  const visibleNoteIds = useMemo(
    () => noteIds.slice(0, renderLimit),
    [noteIds, renderLimit],
  );
  useNoteEngagementSub(visibleNoteIds, engagementRelays);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <FeedToolbar
        isRefreshing={meta.isRefreshing}
        onRefresh={refresh}
        rightSlot={isFriendsFeed ? <FeedPrefsButton channelType="notes" /> : undefined}
      />
      <div ref={scrollRef} className={`flex-1 overflow-y-auto p-5 ${scrollPaddingClass}`}>
        {isFriendsFeed && <NoteComposer className="mb-4 w-full" />}
        {notes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              {isFriendsFeed
                ? "No notes yet from people you follow"
                : activeSpace?.mode === "read"
                  ? "No notes yet -- add feed sources to see content here"
                  : "No notes yet from space members"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleNotes.map((event, index) => (
              <div
                key={event.id}
                className={index < 15 ? "animate-fade-in-up" : undefined}
                style={index < 15 ? { animationDelay: `${index * 50}ms` } : undefined}
              >
                {event.kind === EVENT_KINDS.REPOST ? (
                  <RepostCard event={event} />
                ) : event.kind === EVENT_KINDS.POLL ? (
                  <PollNoteCard event={event} />
                ) : (
                  <NoteCard event={event} />
                )}
              </div>
            ))}
            {/* Reveal more rendered cards as you approach the end; once the whole
                fetched set is shown, fall back to fetching more from the relay. */}
            {hasMoreLocal && <RevealSentinel onReach={revealMore} />}
            <LoadMoreButton
              isLoading={meta.isLoadingMore}
              hasMore={!hasMoreLocal && meta.hasMore}
              onLoadMore={loadMore}
            />
          </div>
        )}
      </div>
    </div>
  );
}
