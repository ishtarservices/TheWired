import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  User,
  Globe,
  Zap,
  AtSign,
  ArrowLeft,
  UserPlus,
  UserCheck,
  MessageCircle,
  Copy,
  Check,
  MoreHorizontal,
  VolumeX,
  Ban,
  Flag,
  HeartHandshake,
  Clock,
  FileText,
  MessageSquare,
  ImageIcon,
  BookOpen,
  Repeat2,
  Loader2,
} from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Avatar } from "../../components/ui/Avatar";
import { Spinner } from "../../components/ui/Spinner";
import { useProfile } from "./useProfile";
import { useProfileFeed } from "./useProfileNotes";
import { useFollowData } from "./useFollowData";
import { useMutualFollow } from "./useMutualFollow";
import { useProfileEngagementSub } from "./useProfileEngagementSub";
import { ProfileNoteCard } from "./NoteCard";
import { FollowListModal } from "./FollowListModal";
import { ArticleCard } from "../longform/ArticleCard";
import { followUser, unfollowUser } from "../../lib/nostr/follow";
import { sendFriendRequest, acceptFriendRequestAction, cancelFriendRequestAction, removeFriendAction, wouldBreakFriendship } from "../../lib/nostr/friendRequest";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setMuteList } from "../../store/slices/identitySlice";
import { buildMuteListEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { useClickOutside } from "../../hooks/useClickOutside";
import { RichContent } from "../../components/content/RichContent";
import type { ProfileFeedItem } from "./useProfileNotes";
import type { LongFormArticle } from "../../types/media";

type Tab = "notes" | "reposts" | "replies" | "media" | "reads";

interface ProfilePageProps {
  pubkey: string;
}

export function ProfilePage({ pubkey }: ProfilePageProps) {
  const { profile } = useProfile(pubkey);
  const [activeTab, setActiveTab] = useState<Tab>("notes");
  const [followModal, setFollowModal] = useState<"following" | "followers" | null>(null);
  const feed = useProfileFeed(pubkey);
  const { following, followers, followingLoading, followersLoading } = useFollowData(pubkey, followModal === "followers");
  const { iFollow, isMutual, loading: followLoading } = useMutualFollow(pubkey);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const muteList = useAppSelector((s) => s.identity.muteList);
  const dispatch = useAppDispatch();
  const friendRequests = useAppSelector((s) => s.friendRequests.requests);
  const isMe = pubkey === myPubkey;
  const isMuted = muteList.some((m) => m.type === "pubkey" && m.value === pubkey);
  const navigate = useNavigate();

  // Per-tab scroll position persistence
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<Tab, number>>({
    notes: 0, reposts: 0, replies: 0, media: 0, reads: 0,
  });

  const handleTabChange = useCallback((newTab: Tab) => {
    // Save current scroll position
    if (scrollRef.current) {
      scrollPositions.current[activeTab] = scrollRef.current.scrollTop;
    }
    setActiveTab(newTab);
  }, [activeTab]);

  // Restore scroll position when tab changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollPositions.current[activeTab];
    }
  }, [activeTab]);

  // Engagement subscriptions — scoped to only the currently visible page's note IDs
  const visibleNoteIds = useMemo(() => {
    const items = activeTab === "notes" ? feed.rootNotes
      : activeTab === "reposts" ? feed.reposts
      : activeTab === "replies" ? feed.replies
      : activeTab === "media" ? feed.mediaItems
      : [];
    return items.map((item) => item.event.id).filter(Boolean);
  }, [activeTab, feed.rootNotes, feed.reposts, feed.replies, feed.mediaItems]);
  useProfileEngagementSub(visibleNoteIds);

  // Derive friend request status for this user
  const friendStatus = useMemo(() => {
    const incoming = friendRequests.find(
      (r) => r.pubkey === pubkey && r.direction === "incoming",
    );
    const outgoing = friendRequests.find(
      (r) => r.pubkey === pubkey && r.direction === "outgoing",
    );
    if (incoming?.status === "accepted" || outgoing?.status === "accepted") return "friends";
    if (outgoing?.status === "pending") return "pending_outgoing";
    if (incoming?.status === "pending") return "pending_incoming";
    return "none";
  }, [friendRequests, pubkey]);
  const npub = useMemo(() => npubEncode(pubkey), [pubkey]);
  const [npubCopied, setNpubCopied] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showUnfollowConfirm, setShowUnfollowConfirm] = useState(false);
  const [showUnfriendConfirm, setShowUnfriendConfirm] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const unfollowConfirmRef = useRef<HTMLDivElement>(null);
  const unfriendConfirmRef = useRef<HTMLDivElement>(null);

  useClickOutside(overflowRef, () => setShowOverflow(false), showOverflow);
  useClickOutside(unfollowConfirmRef, () => setShowUnfollowConfirm(false), showUnfollowConfirm);
  useClickOutside(unfriendConfirmRef, () => setShowUnfriendConfirm(false), showUnfriendConfirm);

  const handleFollow = useCallback(async () => {
    if (iFollow) {
      if (wouldBreakFriendship(pubkey)) {
        setShowUnfollowConfirm(true);
        return;
      }
      await unfollowUser(pubkey);
    } else {
      await followUser(pubkey);
    }
  }, [pubkey, iFollow]);

  const handleConfirmUnfollow = useCallback(async () => {
    setShowUnfollowConfirm(false);
    await removeFriendAction(pubkey);
  }, [pubkey]);

  const handleConfirmUnfriend = useCallback(async () => {
    setShowUnfriendConfirm(false);
    await removeFriendAction(pubkey);
  }, [pubkey]);

  const handleMute = useCallback(async () => {
    if (!myPubkey) return;
    const newMutes = isMuted
      ? muteList.filter((m) => !(m.type === "pubkey" && m.value === pubkey))
      : [...muteList, { type: "pubkey" as const, value: pubkey }];

    const now = Math.floor(Date.now() / 1000);
    dispatch(setMuteList({ mutes: newMutes, createdAt: now }));

    const unsigned = buildMuteListEvent(myPubkey, newMutes);
    await signAndPublish(unsigned);
    setShowOverflow(false);
  }, [myPubkey, pubkey, isMuted, muteList, dispatch]);

  const handleCopyPubkey = useCallback(() => {
    navigator.clipboard.writeText(npub);
    setNpubCopied(true);
    setTimeout(() => setNpubCopied(false), 2000);
    setShowOverflow(false);
  }, [npub]);

  if (!profile) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const displayName =
    profile?.display_name || profile?.name || pubkey.slice(0, 12) + "...";

  const tabs: { id: Tab; label: string; icon: typeof FileText; count?: number }[] = [
    { id: "notes", label: "Notes", icon: FileText, count: feed.totalNotes },
    { id: "reposts", label: "Reposts", icon: Repeat2, count: feed.totalReposts },
    { id: "replies", label: "Replies", icon: MessageSquare, count: feed.totalReplies },
    { id: "media", label: "Media", icon: ImageIcon, count: feed.totalMedia },
    { id: "reads", label: "Reads", icon: BookOpen, count: feed.totalArticles },
  ];

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Banner */}
      <div className="relative h-40 shrink-0 overflow-hidden bg-gradient-to-r from-pulse/40 to-neon/15">
        {profile?.banner && (
          <img
            src={profile.banner}
            alt="banner"
            className="h-full w-full object-cover"
          />
        )}
        <button
          onClick={() => navigate("/")}
          className="absolute left-3 top-3 rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>
      </div>

      {/* Profile info */}
      <div className="relative z-10 px-6 pb-4">
        <div className="-mt-12 mb-4 flex items-end justify-between">
          <Avatar src={profile?.picture} alt={displayName} size="lg" className="h-24 w-24 border-4 border-backdrop ring-2 ring-pulse/20" />

          {/* Action buttons */}
          {!isMe && (
            <div className="flex items-center gap-2 pb-1">
              <button
                onClick={() => navigate(`/dm/${pubkey}`)}
                className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 text-sm font-medium text-heading hover:bg-surface-hover transition-colors"
              >
                <MessageCircle size={14} />
                Message
              </button>

              {/* Add Friend / Request Status */}
              {friendStatus === "none" && (
                <button
                  onClick={() => sendFriendRequest(pubkey)}
                  className="flex items-center gap-1.5 rounded-lg bg-neon/20 px-4 py-2 text-sm font-medium text-neon hover:bg-neon/30 transition-colors"
                >
                  <HeartHandshake size={14} />
                  Add Friend
                </button>
              )}
              {friendStatus === "pending_outgoing" && (
                <button
                  onClick={() => cancelFriendRequestAction(pubkey)}
                  className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 text-sm font-medium text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  title="Cancel request"
                >
                  <Clock size={14} />
                  Request Sent
                </button>
              )}
              {friendStatus === "pending_incoming" && (
                <button
                  onClick={() => acceptFriendRequestAction(pubkey)}
                  className="flex items-center gap-1.5 rounded-lg bg-pulse/20 px-4 py-2 text-sm font-medium text-pulse hover:bg-pulse/30 transition-colors"
                >
                  <HeartHandshake size={14} />
                  Accept Request
                </button>
              )}
              {friendStatus === "friends" && (
                <div className="relative">
                <button
                  onClick={() => setShowUnfriendConfirm(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-pulse/15 px-4 py-2 text-sm font-semibold text-pulse hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  title="Remove friend"
                >
                  <HeartHandshake size={14} />
                  Friends
                </button>

                {showUnfriendConfirm && (
                  <div
                    ref={unfriendConfirmRef}
                    className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-edge-light p-3"
                    style={{
                      backgroundColor: "var(--color-card)",
                      boxShadow: "var(--shadow-elevated)",
                    }}
                  >
                    <p className="text-xs text-heading font-medium mb-1">
                      Remove this user as a friend?
                    </p>
                    <p className="text-[11px] text-muted mb-3">
                      This will also unfollow them. You can re-send a friend request later.
                    </p>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setShowUnfriendConfirm(false)}
                        className="rounded-md px-2.5 py-1 text-xs text-soft hover:bg-surface-hover transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmUnfriend}
                        className="rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                      >
                        Remove Friend
                      </button>
                    </div>
                  </div>
                )}
                </div>
              )}

              <div className="relative">
              <button
                onClick={handleFollow}
                disabled={followLoading}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  iFollow
                    ? "bg-surface-hover text-heading hover:bg-red-500/10 hover:text-red-400"
                    : "bg-pulse/20 text-pulse hover:bg-pulse/30"
                }`}
              >
                {iFollow ? (
                  <>
                    <UserCheck size={14} />
                    Following
                  </>
                ) : (
                  <>
                    <UserPlus size={14} />
                    Follow
                  </>
                )}
              </button>

              {/* Unfollow-friend confirmation popover */}
              {showUnfollowConfirm && (
                <div
                  ref={unfollowConfirmRef}
                  className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-edge-light p-3"
                  style={{
                    backgroundColor: "var(--color-card)",
                    boxShadow: "var(--shadow-elevated)",
                  }}
                >
                  <p className="text-xs text-heading font-medium mb-1">
                    Unfollowing will also remove them as a friend.
                  </p>
                  <p className="text-[11px] text-muted mb-3">
                    Are you sure you want to continue?
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setShowUnfollowConfirm(false)}
                      className="rounded-md px-2.5 py-1 text-xs text-soft hover:bg-surface-hover transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmUnfollow}
                      className="rounded-md bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      Unfollow & Unfriend
                    </button>
                  </div>
                </div>
              )}
              </div>

              {/* Overflow menu */}
              <div className="relative" ref={overflowRef}>
                <button
                  onClick={() => setShowOverflow((v) => !v)}
                  className="flex items-center justify-center rounded-lg bg-surface-hover p-2 text-heading hover:bg-surface-hover transition-colors"
                >
                  <MoreHorizontal size={14} />
                </button>

                {showOverflow && (
                  <div
                    className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-edge-light overflow-hidden"
                    style={{
                      backgroundColor: "var(--color-card)",
                      boxShadow: "var(--shadow-elevated)",
                    }}
                  >
                    <button
                      onClick={handleCopyPubkey}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-heading hover:bg-surface-hover transition-colors"
                    >
                      <Copy size={13} />
                      {npubCopied ? "Copied!" : "Copy Public Key"}
                    </button>

                    <div className="border-t border-edge" />

                    <button
                      onClick={handleMute}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-heading hover:bg-surface-hover transition-colors"
                    >
                      <VolumeX size={13} />
                      {isMuted ? "Unmute" : "Mute"}
                    </button>
                    <button
                      onClick={() => {
                        if (!isMuted) handleMute();
                        if (iFollow) unfollowUser(pubkey);
                        setShowOverflow(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Ban size={13} />
                      Block
                    </button>
                    <button
                      onClick={() => {
                        console.warn(`Report user: ${pubkey}`);
                        setShowOverflow(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Flag size={13} />
                      Report User
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-heading">{displayName}</h1>
          {friendStatus === "friends" && isMutual && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pulse/15 px-2.5 py-0.5 text-xs font-semibold text-pulse">
              <HeartHandshake size={12} />
              Friends
            </span>
          )}
          {iFollow && !(friendStatus === "friends" && isMutual) && !isMe && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-semibold text-muted">
              Following
            </span>
          )}
        </div>

        {profile?.nip05 && (
          <div className="mt-1 flex items-center gap-1 text-sm text-neon">
            <AtSign size={14} />
            <span>{profile.nip05}</span>
          </div>
        )}

        {profile?.about && (
          <div className="mt-3 text-sm text-body">
            <RichContent content={profile.about} />
          </div>
        )}

        <div className="mt-4 flex gap-4 text-sm text-soft">
          {profile?.website && (
            <a
              href={profile.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-neon transition-colors"
            >
              <Globe size={14} />
              <span>{profile.website}</span>
            </a>
          )}
          {profile?.lud16 && (
            <div className="flex items-center gap-1">
              <Zap size={14} />
              <span>{profile.lud16}</span>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(npub);
            setNpubCopied(true);
            setTimeout(() => setNpubCopied(false), 2000);
          }}
          className="mt-2 flex items-center gap-1.5 text-xs text-muted hover:text-heading transition-colors group"
          title="Copy npub"
        >
          <User size={12} className="shrink-0" />
          <span className="font-mono">{npub.slice(0, 20)}...{npub.slice(-6)}</span>
          {npubCopied ? (
            <Check size={12} className="shrink-0 text-green-400" />
          ) : (
            <Copy size={12} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
      </div>

      {/* Stats bar — clickable Following/Followers */}
      <div className="flex gap-8 border-b border-edge px-8 pb-3 text-sm">
        <span className="text-soft">
          <span className="font-semibold text-heading">{feed.allItems.length}</span> Notes
        </span>
        <button
          onClick={() => setFollowModal("following")}
          className="text-soft hover:text-neon transition-colors"
        >
          <span className="font-semibold text-heading">
            {followingLoading ? "\u2014" : following.length}
          </span> Following
        </button>
        <button
          onClick={() => setFollowModal("followers")}
          className="text-soft hover:text-neon transition-colors"
        >
          <span className="font-semibold text-heading">
            {followers.length > 0 ? followers.length : "\u2014"}
          </span> Followers
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-edge">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-1.5 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-pulse text-pulse"
                  : "text-soft hover:text-heading"
              }`}
            >
              <Icon size={14} />
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1 text-xs text-muted">{tab.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content — only active tab renders */}
      <div className="flex-1 px-6 py-4">
        {activeTab === "notes" && (
          <FeedTab
            items={feed.rootNotes}
            loading={feed.loading}
            eoseReceived={feed.eoseReceived}
            hasMore={feed.hasMoreNotes}
            onLoadMore={feed.loadMoreNotes}
            fetchingMore={feed.fetchingMore}
            onFetchOlder={feed.fetchOlderFromRelay}
            emptyIcon={<FileText size={32} className="text-faint" />}
            emptyText="No notes yet"
          />
        )}
        {activeTab === "reposts" && (
          <FeedTab
            items={feed.reposts}
            loading={feed.loading}
            eoseReceived={feed.eoseReceived}
            hasMore={feed.hasMoreReposts}
            onLoadMore={feed.loadMoreReposts}
            emptyIcon={<Repeat2 size={32} className="text-faint" />}
            emptyText="No reposts yet"
          />
        )}
        {activeTab === "replies" && (
          <FeedTab
            items={feed.replies}
            loading={feed.loading}
            eoseReceived={feed.eoseReceived}
            hasMore={feed.hasMoreReplies}
            onLoadMore={feed.loadMoreReplies}
            showThreadContext
            emptyIcon={<MessageSquare size={32} className="text-faint" />}
            emptyText="No replies yet"
          />
        )}
        {activeTab === "media" && (
          <FeedTab
            items={feed.mediaItems}
            loading={feed.loading}
            eoseReceived={feed.eoseReceived}
            hasMore={feed.hasMoreMedia}
            onLoadMore={feed.loadMoreMedia}
            emptyIcon={<ImageIcon size={32} className="text-faint" />}
            emptyText="No media posts yet"
          />
        )}
        {activeTab === "reads" && (
          <ReadsTab
            articles={feed.articles}
            loading={!feed.articlesEose && feed.articles.length === 0}
            hasMore={feed.hasMoreArticles}
            onLoadMore={feed.loadMoreArticles}
          />
        )}
      </div>

      {/* Follow list modals */}
      {followModal === "following" && (
        <FollowListModal
          pubkeys={following}
          loading={followingLoading}
          mode="following"
          onClose={() => setFollowModal(null)}
        />
      )}
      {followModal === "followers" && (
        <FollowListModal
          pubkeys={followers}
          loading={followersLoading}
          mode="followers"
          onClose={() => setFollowModal(null)}
        />
      )}
    </div>
  );
}

/** IntersectionObserver sentinel for auto-loading next page */
function LoadMoreSentinel({ onIntersect }: { onIntersect: () => void }) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onIntersect();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [onIntersect]);

  return <div ref={sentinelRef} className="h-1" />;
}

/** Generic feed tab for Notes/Replies/Media with pagination */
function FeedTab({
  items,
  loading,
  eoseReceived,
  showThreadContext,
  hasMore,
  onLoadMore,
  fetchingMore,
  onFetchOlder,
  emptyIcon,
  emptyText,
}: {
  items: ProfileFeedItem[];
  loading: boolean;
  eoseReceived: boolean;
  showThreadContext?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  fetchingMore?: boolean;
  onFetchOlder?: () => void;
  emptyIcon: React.ReactNode;
  emptyText: string;
}) {
  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (items.length === 0 && eoseReceived) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        {emptyIcon}
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <ProfileNoteCard
          key={item.event.id}
          item={item}
          showThreadContext={showThreadContext}
          animationDelay={i < 15 ? i * 40 : undefined}
        />
      ))}

      {/* Auto-load next page when sentinel is visible */}
      {hasMore && onLoadMore && (
        <LoadMoreSentinel onIntersect={onLoadMore} />
      )}

      {/* Fetching more from relay indicator */}
      {fetchingMore && (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" />
          Loading older notes...
        </div>
      )}

      {/* Fetch older from relay when all local items shown */}
      {!hasMore && eoseReceived && items.length > 0 && onFetchOlder && (
        <button
          onClick={onFetchOlder}
          disabled={fetchingMore}
          className="mx-auto mt-2 rounded-lg bg-surface px-4 py-2 text-xs text-muted hover:bg-surface-hover hover:text-heading transition-colors disabled:opacity-50"
        >
          Load older notes
        </button>
      )}

      {!eoseReceived && (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
}

/** Reads tab for kind:30023 articles with pagination */
function ReadsTab({
  articles,
  loading,
  hasMore,
  onLoadMore,
}: {
  articles: LongFormArticle[];
  loading: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <BookOpen size={32} className="text-faint" />
        <p className="text-sm text-muted">No articles yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {articles.map((article, i) => (
        <div
          key={article.eventId}
          className="animate-fade-in-up"
          style={{ animationDelay: `${Math.min(i, 15) * 40}ms` }}
        >
          <ArticleCard
            article={article}
            onClick={() => navigate(`/article/${article.eventId}`)}
          />
        </div>
      ))}

      {hasMore && onLoadMore && (
        <LoadMoreSentinel onIntersect={onLoadMore} />
      )}
    </div>
  );
}
