import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from "react";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { DMMessage } from "./DMMessage";
import { DMInput } from "./DMInput";
import { UnreadDivider } from "@/components/chat/UnreadDivider";
import { useDMConversation } from "./useDMConversation";
import { sendDM } from "./dmService";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { markConversationRead, clearDMUnreadDivider } from "@/store/slices/dmSlice";
import { markDMNotificationsRead } from "@/store/slices/notificationSlice";
import { getDisplayName } from "./dmUtils";
import { ArrowLeft, ChevronDown } from "lucide-react";

interface DMConversationProps {
  partnerPubkey: string;
  onBack: () => void;
}

/** Threshold in px: if the user is within this distance of the bottom, we auto-scroll */
const SCROLL_BOTTOM_THRESHOLD = 60;

/** Format a unix timestamp as a date separator label */
function formatDateLabel(ts: number): string {
  const date = new Date(ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "Today";
  if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Check whether two timestamps fall on different calendar days */
function isDifferentDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1 * 1000);
  const d2 = new Date(ts2 * 1000);
  return (
    d1.getFullYear() !== d2.getFullYear() ||
    d1.getMonth() !== d2.getMonth() ||
    d1.getDate() !== d2.getDate()
  );
}

export function DMConversation({ partnerPubkey, onBack }: DMConversationProps) {
  const dispatch = useAppDispatch();
  const messages = useDMConversation(partnerPubkey);
  const { profile } = useProfile(partnerPubkey);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToUnread = useRef(false);
  const isNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // File upload — owned here so dropZoneRef covers the entire DM view
  const upload = useFileUpload();

  // Unread divider: count captured by setActiveConversation before clearing
  const unreadCount = useAppSelector(
    (s) => s.dm.unreadDividers[partnerPubkey],
  );

  const displayName = getDisplayName(profile, partnerPubkey);

  // Compute divider position: insert before the first unread message
  const dividerIndex = unreadCount && unreadCount > 0 && messages.length > 0
    ? Math.max(0, messages.length - unreadCount)
    : -1;

  // Track scroll position to decide whether to auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  }, []);

  // Track whether initial scroll has happened for this conversation
  const hasInitialScrolled = useRef(false);

  // Scroll positioning — useLayoutEffect runs before paint to avoid flicker.
  // On initial open: scroll to unread divider (near top) or to bottom.
  // On subsequent message additions: only auto-scroll if already near bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;

    if (!hasInitialScrolled.current) {
      // First time we have messages for this conversation
      if (dividerRef.current && dividerIndex > 0) {
        hasScrolledToUnread.current = true;
        // Scroll divider near the top so new messages are visible below
        dividerRef.current.scrollIntoView({ block: "start" });
        // Nudge up a bit so divider isn't flush with the top edge
        el.scrollTop = Math.max(0, el.scrollTop - 40);
      } else {
        // No unreads — start at the bottom
        el.scrollTop = el.scrollHeight;
      }
      hasInitialScrolled.current = true;
    } else {
      // Messages changed after initial render — only scroll if near bottom
      if (isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages.length, dividerIndex]);

  // Reset scroll tracking when partner changes
  useLayoutEffect(() => {
    hasScrolledToUnread.current = false;
    hasInitialScrolled.current = false;
    isNearBottomRef.current = true;
    setShowScrollButton(false);
  }, [partnerPubkey]);

  // Mark as read — sync both DM unread count and notification bell.
  // Re-runs when messages.length changes so that if restoreDMState loads
  // contacts with stale unread counts AFTER this component mounts, the
  // unread badge is cleared immediately.
  const currentUnread = useAppSelector((s) => {
    const c = s.dm.contacts.find((c) => c.pubkey === partnerPubkey);
    return c?.unreadCount ?? 0;
  });

  useEffect(() => {
    if (currentUnread > 0) {
      dispatch(markConversationRead(partnerPubkey));
    }
  }, [partnerPubkey, currentUnread, dispatch]);

  // Clear notification bell on mount and partner change
  useEffect(() => {
    dispatch(markDMNotificationsRead(partnerPubkey));
  }, [partnerPubkey, dispatch]);

  const handleDividerFaded = useCallback(() => {
    dispatch(clearDMUnreadDivider(partnerPubkey));
  }, [dispatch, partnerPubkey]);

  const handleSend = useCallback(
    async (content: string) => {
      try {
        await sendDM(partnerPubkey, content);
        // Scroll to bottom after sending
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        });
      } catch (err) {
        console.error("Failed to send DM:", err);
      }
    },
    [partnerPubkey],
  );

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, []);

  // Precompute grouping & date separator info for messages
  const messageLayout = useMemo(() => {
    return messages.map((msg, i) => {
      const prev = i > 0 ? messages[i - 1] : null;
      const isGrouped = !!prev && prev.senderPubkey === msg.senderPubkey && !isDifferentDay(prev.createdAt, msg.createdAt);
      const showDateSeparator = !prev || isDifferentDay(prev.createdAt, msg.createdAt);
      return { msg, isGrouped, showDateSeparator };
    });
  }, [messages]);

  return (
    <div ref={upload.dropZoneRef} className="relative flex flex-1 flex-col overflow-hidden">
      {/* Drag overlay — covers the entire DM view */}
      {upload.dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-pulse/40 bg-pulse/[0.06] backdrop-blur-[1px]">
          <div className="rounded-xl bg-surface/80 px-6 py-4 text-center shadow-lg border border-pulse/20">
            <p className="text-sm font-medium text-pulse">Drop files to attach</p>
            <p className="mt-1 text-xs text-muted">Images, videos, audio, or PDFs</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
        <button
          onClick={onBack}
          className="rounded-lg p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <Avatar src={profile?.picture} alt={displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-heading truncate">
            {displayName}
          </div>
          {profile?.nip05 && (
            <div className="text-xs text-muted truncate">{profile.nip05}</div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-4"
        style={{ overflowAnchor: "auto" }}
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted">No messages yet</p>
              <p className="mt-1 text-xs text-faint">
                Messages are end-to-end encrypted
              </p>
            </div>
          </div>
        ) : (
          messageLayout.map(({ msg, isGrouped, showDateSeparator }, i) => (
            <div key={msg.wrapId}>
              {/* Date separator */}
              {showDateSeparator && (
                <div className="flex items-center gap-3 px-6 py-3">
                  <div className="flex-1 border-t border-edge" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                    {formatDateLabel(msg.createdAt)}
                  </span>
                  <div className="flex-1 border-t border-edge" />
                </div>
              )}
              {/* Unread divider */}
              {i === dividerIndex && (
                <UnreadDivider ref={dividerRef} onFaded={handleDividerFaded} />
              )}
              <DMMessage
                message={msg}
                partnerPubkey={partnerPubkey}
                isGrouped={isGrouped}
              />
            </div>
          ))
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-edge shadow-lg text-muted hover:text-heading hover:bg-surface-hover transition-all animate-fade-in-up"
          title="Scroll to bottom"
        >
          <ChevronDown size={18} />
        </button>
      )}

      {/* Input */}
      <DMInput
        onSend={handleSend}
        attachments={upload.attachments}
        onRemoveAttachment={upload.removeAttachment}
        onClearAttachments={upload.clearAttachments}
        onOpenFilePicker={upload.openFilePicker}
        onAddFiles={upload.addFiles}
        fileInputRef={upload.fileInputRef}
        onFileInputChange={upload.handleFileInputChange}
        isUploading={upload.isUploading}
        hasAttachments={upload.hasAttachments}
      />
    </div>
  );
}
