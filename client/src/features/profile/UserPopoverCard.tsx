import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  UserPlus,
  UserCheck,
  MessageCircle,
  ExternalLink,
  MoreHorizontal,
  VolumeX,
  Ban,
  Flag,
  Copy,
  HeartHandshake,
  Clock,
} from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Avatar } from "@/components/ui/Avatar";
import { RichContent } from "@/components/content/RichContent";
import { useProfile } from "./useProfile";
import { useMutualSpaces } from "./useMutualSpaces";
import { useMutualFollow } from "./useMutualFollow";
import { useClickOutside } from "@/hooks/useClickOutside";
import { followUser, unfollowUser } from "@/lib/nostr/follow";
import { sendFriendRequest, acceptFriendRequestAction, cancelFriendRequestAction, removeFriendAction, wouldBreakFriendship } from "@/lib/nostr/friendRequest";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMuteList } from "@/store/slices/identitySlice";
import { buildMuteListEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

const CARD_WIDTH = 320;
const GAP = 8;
const VIEWPORT_PAD = 12;

interface UserPopoverCardProps {
  pubkey: string;
  anchorEl: HTMLElement;
  onClose: () => void;
  onMessage?: (pubkey: string) => void;
}

/**
 * Compute best position for the popover card relative to anchor.
 *
 * Priority order:
 *  1. Right of anchor — top-left of card near top-right of anchor
 *  2. Left of anchor  — top-right of card near top-left of anchor
 *  3. Below anchor    — centered horizontally
 *
 * Vertical is clamped so the card stays within the viewport.
 */
function computePosition(
  anchorRect: DOMRect,
  cardHeight: number,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Vertical: align card top with anchor top, then clamp
  const clampTop = (t: number) =>
    Math.max(VIEWPORT_PAD, Math.min(t, vh - cardHeight - VIEWPORT_PAD));

  // 1. Try right
  const rightLeft = anchorRect.right + GAP;
  if (rightLeft + CARD_WIDTH + VIEWPORT_PAD <= vw) {
    return { top: clampTop(anchorRect.top), left: rightLeft };
  }

  // 2. Try left
  const leftLeft = anchorRect.left - GAP - CARD_WIDTH;
  if (leftLeft >= VIEWPORT_PAD) {
    return { top: clampTop(anchorRect.top), left: leftLeft };
  }

  // 3. Fallback: below, centered on anchor
  let left = anchorRect.left + anchorRect.width / 2 - CARD_WIDTH / 2;
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - CARD_WIDTH - VIEWPORT_PAD));
  let top = anchorRect.bottom + GAP;
  if (top + cardHeight + VIEWPORT_PAD > vh) {
    top = anchorRect.top - cardHeight - GAP;
  }
  return { top: Math.max(VIEWPORT_PAD, top), left };
}

export function UserPopoverCard({
  pubkey,
  anchorEl,
  onClose,
  onMessage,
}: UserPopoverCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { profile } = useProfile(pubkey);
  const mutualSpaces = useMutualSpaces(pubkey);
  const { iFollow, isMutual, loading: followLoading } = useMutualFollow(pubkey);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const muteList = useAppSelector((s) => s.identity.muteList);
  const friendRequests = useAppSelector((s) => s.friendRequests.requests);
  const isMe = pubkey === myPubkey;
  const isMuted = muteList.some((m) => m.type === "pubkey" && m.value === pubkey);

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

  const [showOverflow, setShowOverflow] = useState(false);
  const [showUnfollowConfirm, setShowUnfollowConfirm] = useState(false);
  const [showUnfriendConfirm, setShowUnfriendConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: -9999,
    left: -9999,
  });

  useClickOutside(cardRef, onClose);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showOverflow) {
          setShowOverflow(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, showOverflow]);

  // Close overflow menu when clicking outside it
  useClickOutside(overflowRef, () => setShowOverflow(false), showOverflow);

  // Position calculation
  const updatePosition = useCallback(() => {
    const rect = anchorEl.getBoundingClientRect();
    const cardHeight = cardRef.current?.offsetHeight ?? 280;
    setPosition(computePosition(rect, cardHeight));
  }, [anchorEl]);

  // Position on mount and whenever dynamic content changes card height
  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, profile, mutualSpaces]);

  // Close on scroll (any container), reposition on resize
  useEffect(() => {
    const onScroll = () => onClose();
    const onResize = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose, updatePosition]);

  const displayName =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

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
    onClose();
  }, [pubkey, onClose]);

  const handleConfirmUnfriend = useCallback(async () => {
    setShowUnfriendConfirm(false);
    await removeFriendAction(pubkey);
    onClose();
  }, [pubkey, onClose]);

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
    const npub = npubEncode(pubkey);
    navigator.clipboard.writeText(npub);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowOverflow(false);
  }, [pubkey]);

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[99] bg-black/40"
        onMouseDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />

      {/* Card */}
      <div
        ref={cardRef}
        className="fixed z-[100] w-80 rounded-xl border border-edge-light overflow-hidden animate-fade-in-up"
        style={{
          top: position.top,
          left: position.left,
          backgroundColor: "var(--color-panel)",
          boxShadow:
            "var(--shadow-elevated), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* Banner */}
        <div
          className="relative h-20 bg-gradient-to-r from-pulse/30 via-neon/20 to-pulse/30"
          style={
            profile?.banner
              ? {
                  backgroundImage: `url(${profile.banner})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          {/* Overflow "..." button */}
          {!isMe && (
            <div className="absolute right-2 top-2">
              <button
                onClick={() => setShowOverflow((v) => !v)}
                className="rounded-full bg-black/50 p-1.5 text-white/80 hover:bg-black/70 hover:text-white transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>

              {showOverflow && (
                <div
                  ref={overflowRef}
                  className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-edge-light overflow-hidden z-10"
                  style={{
                    backgroundColor: "var(--color-card)",
                    boxShadow: "var(--shadow-elevated)",
                  }}
                >
                  <button
                    onClick={() => {
                      navigate(`/profile/${pubkey}`);
                      onClose();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-heading hover:bg-surface-hover transition-colors"
                  >
                    <ExternalLink size={13} />
                    View Full Profile
                  </button>
                  <button
                    onClick={handleCopyPubkey}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-xs text-heading hover:bg-surface-hover transition-colors"
                  >
                    <Copy size={13} />
                    {copied ? "Copied!" : "Copy Public Key"}
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
                      onClose();
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
          )}
        </div>

        {/* Avatar + Name — relative z-10 so it paints above the banner */}
        <div className="relative z-10 px-4 -mt-7">
          <div className="flex items-end gap-3">
            <div
              className="shrink-0 rounded-full"
              style={{ boxShadow: "0 0 0 3px var(--color-panel)" }}
            >
              <Avatar
                src={profile?.picture}
                alt={displayName}
                size="lg"
              />
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-heading truncate">
                  {displayName}
                </span>
                {friendStatus === "friends" && isMutual && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-pulse/15 px-2 py-0.5 text-[10px] font-semibold text-pulse shrink-0">
                    <HeartHandshake size={10} />
                    Friends
                  </span>
                )}
                {iFollow && !(friendStatus === "friends" && isMutual) && !isMe && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-semibold text-muted shrink-0">
                    Following
                  </span>
                )}
              </div>
              {profile?.name && profile?.display_name && (
                <div className="text-xs text-muted truncate">
                  @{profile.name}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* NIP-05 */}
        {profile?.nip05 && (
          <div className="px-4 mt-1.5">
            <span className="text-xs text-neon/70">{profile.nip05}</span>
          </div>
        )}

        {/* About */}
        {profile?.about && (
          <div className="px-4 mt-2 text-xs text-soft line-clamp-3 leading-relaxed">
            <RichContent content={profile.about} />
          </div>
        )}

        {/* Mutual Spaces */}
        {mutualSpaces.length > 0 && (
          <div className="px-4 mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
              Mutual Spaces
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mutualSpaces.slice(0, 5).map((space) => (
                <span
                  key={space.id}
                  className="inline-flex items-center rounded-full bg-surface-hover px-2.5 py-0.5 text-[11px] text-soft"
                >
                  {space.name}
                </span>
              ))}
              {mutualSpaces.length > 5 && (
                <span className="text-[11px] text-muted">
                  +{mutualSpaces.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="px-4 py-3 mt-2 border-t border-edge space-y-2">
          {/* Row 1: Profile, Message, Follow */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                navigate(`/profile/${pubkey}`);
                onClose();
              }}
              className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-heading hover:bg-surface-hover/80 transition-colors"
            >
              <ExternalLink size={12} />
              Profile
            </button>

            {!isMe && (
              <>
                {onMessage && (
                  <button
                    onClick={() => {
                      onMessage(pubkey);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-heading hover:bg-surface-hover/80 transition-colors"
                  >
                    <MessageCircle size={12} />
                    Message
                  </button>
                )}

                <button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ml-auto ${
                    iFollow
                      ? "bg-surface-hover text-muted hover:bg-red-500/10 hover:text-red-400"
                      : "bg-pulse/20 text-pulse hover:bg-pulse/30"
                  }`}
                >
                  {iFollow ? (
                    <>
                      <UserCheck size={12} />
                      Following
                    </>
                  ) : (
                    <>
                      <UserPlus size={12} />
                      Follow
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {/* Row 2: Friend request action */}
          {!isMe && (
            <div className="flex items-center">
              {friendStatus === "none" && (
                <button
                  onClick={() => {
                    sendFriendRequest(pubkey);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-neon/20 px-3 py-1.5 text-xs font-medium text-neon hover:bg-neon/30 transition-colors w-full justify-center"
                >
                  <HeartHandshake size={12} />
                  Add Friend
                </button>
              )}
              {friendStatus === "pending_outgoing" && (
                <button
                  onClick={() => cancelFriendRequestAction(pubkey)}
                  className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors w-full justify-center"
                  title="Cancel request"
                >
                  <Clock size={12} />
                  Request Sent
                </button>
              )}
              {friendStatus === "pending_incoming" && (
                <button
                  onClick={() => {
                    acceptFriendRequestAction(pubkey);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-pulse/20 px-3 py-1.5 text-xs font-medium text-pulse hover:bg-pulse/30 transition-colors w-full justify-center"
                >
                  <HeartHandshake size={12} />
                  Accept Friend Request
                </button>
              )}
              {friendStatus === "friends" && !showUnfriendConfirm && (
                <button
                  onClick={() => setShowUnfriendConfirm(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-pulse/15 px-3 py-1.5 text-xs font-semibold text-pulse hover:bg-red-500/10 hover:text-red-400 transition-colors w-full justify-center"
                  title="Remove friend"
                >
                  <HeartHandshake size={12} />
                  Friends
                </button>
              )}
              {friendStatus === "friends" && showUnfriendConfirm && (
                <div className="w-full rounded-lg border border-edge-light p-2.5 space-y-2">
                  <p className="text-[11px] text-heading font-medium">
                    Remove this user as a friend?
                  </p>
                  <p className="text-[10px] text-muted">
                    This will also unfollow them. You can re-send a friend request later.
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => setShowUnfriendConfirm(false)}
                      className="rounded-md px-2 py-1 text-[10px] text-soft hover:bg-surface-hover transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmUnfriend}
                      className="rounded-md bg-red-500/20 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      Remove Friend
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Unfollow-friend confirmation */}
          {showUnfollowConfirm && (
            <div className="px-4 py-2 border-t border-edge">
              <p className="text-[11px] text-heading font-medium mb-1">
                Unfollowing will also remove them as a friend.
              </p>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setShowUnfollowConfirm(false)}
                  className="rounded-md px-2 py-1 text-[10px] text-soft hover:bg-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmUnfollow}
                  className="rounded-md bg-red-500/20 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Unfollow & Unfriend
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
