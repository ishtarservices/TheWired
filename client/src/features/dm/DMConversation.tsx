import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from "react";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { DMMessage } from "./DMMessage";
import { DMInput } from "./DMInput";
import { UnreadDivider } from "@/components/chat/UnreadDivider";
import { useDMConversation } from "./useDMConversation";
import { sendDM, editDM, deleteDMForEveryone } from "./dmService";
import { useFileUpload } from "@/hooks/useFileUpload";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { markConversationRead, clearDMUnreadDivider } from "@/store/slices/dmSlice";
import type { DMMessage as DMMessageType } from "@/store/slices/dmSlice";
import { markDMNotificationsRead } from "@/store/slices/notificationSlice";
import { getDisplayName } from "./dmUtils";
import { ArrowLeft, ChevronDown, Phone, Video, X, Pencil, ArrowDown, Reply } from "lucide-react";
import { useCall } from "@/features/calling/useCall";

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
  const { scrollPaddingClass, inputMarginClass } = usePlaybackBarSpacing();

  // Unread divider: count captured by setActiveConversation before clearing
  const unreadCount = useAppSelector(
    (s) => s.dm.unreadDividers[partnerPubkey],
  );

  const displayName = getDisplayName(profile, partnerPubkey);
  const { startCall, isInCall } = useCall();
  const [editingMessage, setEditingMessage] = useState<DMMessageType | null>(null);
  const [replyTo, setReplyTo] = useState<DMMessageType | null>(null);

  // Reply jump navigation state
  const [highlightedWrapId, setHighlightedWrapId] = useState<string | null>(null);
  const [jumpBackWrapId, setJumpBackWrapId] = useState<string | null>(null);

  const scrollToMessage = useCallback((targetWrapId: string, sourceWrapId?: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const targetEl = container.querySelector(`[data-wrap-id="${targetWrapId}"]`);
    if (!targetEl) return;

    if (sourceWrapId) {
      setJumpBackWrapId(sourceWrapId);
    }

    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedWrapId(targetWrapId);
    setTimeout(() => setHighlightedWrapId(null), 1500);
  }, []);

  const handleJumpBack = useCallback(() => {
    if (!jumpBackWrapId) return;
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-wrap-id="${jumpBackWrapId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedWrapId(jumpBackWrapId);
    setTimeout(() => setHighlightedWrapId(null), 1500);
    setJumpBackWrapId(null);
  }, [jumpBackWrapId]);

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
        await sendDM(partnerPubkey, content, replyTo ? { wrapId: replyTo.wrapId } : undefined);
        setReplyTo(null);
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
    [partnerPubkey, replyTo],
  );

  const handleEditSubmit = useCallback(
    async (message: DMMessageType, newContent: string) => {
      try {
        const rumorId = message.rumorId ?? message.wrapId;
        await editDM(partnerPubkey, rumorId, newContent, message.createdAt);
        setEditingMessage(null);
      } catch (err) {
        console.error("Failed to edit DM:", err);
      }
    },
    [partnerPubkey],
  );

  const handleDeleteForEveryone = useCallback(
    async (message: DMMessageType) => {
      try {
        const rumorId = message.rumorId ?? message.wrapId;
        await deleteDMForEveryone(partnerPubkey, rumorId);
      } catch (err) {
        console.error("Failed to delete DM:", err);
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => startCall(partnerPubkey, "audio")}
            disabled={isInCall}
            className="rounded-lg p-2 text-muted hover:text-heading hover:bg-surface-hover transition-colors disabled:opacity-50"
            title="Voice call"
          >
            <Phone size={16} />
          </button>
          <button
            onClick={() => startCall(partnerPubkey, "video")}
            disabled={isInCall}
            className="rounded-lg p-2 text-muted hover:text-heading hover:bg-surface-hover transition-colors disabled:opacity-50"
            title="Video call"
          >
            <Video size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto py-4 ${scrollPaddingClass}`}
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
            <div
              key={msg.wrapId}
              data-wrap-id={msg.wrapId}
              className={highlightedWrapId === msg.wrapId ? "animate-highlight-flash rounded" : ""}
            >
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
                onEdit={setEditingMessage}
                onDeleteForEveryone={handleDeleteForEveryone}
                onReply={(m) => { setReplyTo(m); setEditingMessage(null); }}
                allMessages={messages}
                onJumpToMessage={(targetWrapId) => scrollToMessage(targetWrapId, msg.wrapId)}
              />
            </div>
          ))
        )}
      </div>

      {/* Jump back button */}
      {jumpBackWrapId && (
        <button
          onClick={handleJumpBack}
          className={`absolute right-4 z-10 flex items-center gap-1.5 rounded-full bg-pulse/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-pulse transition-colors animate-fade-in-up ${inputMarginClass ? "bottom-28" : "bottom-20"}`}
        >
          <ArrowDown size={12} />
          Jump back
        </button>
      )}

      {/* Scroll to bottom button */}
      {showScrollButton && !jumpBackWrapId && (
        <button
          onClick={scrollToBottom}
          className={`absolute right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-surface border border-edge shadow-lg text-muted hover:text-heading hover:bg-surface-hover transition-all animate-fade-in-up ${inputMarginClass ? "bottom-28" : "bottom-20"}`}
          title="Scroll to bottom"
        >
          <ChevronDown size={18} />
        </button>
      )}

      {/* Reply indicator */}
      {replyTo && !editingMessage && (
        <div className="flex items-center gap-2 border-t border-edge bg-panel px-4 py-2">
          <div className="h-4 w-0.5 rounded-full bg-pulse" />
          <Reply size={12} className="text-pulse shrink-0" />
          <span className="text-xs text-soft min-w-0 flex-1 truncate">
            Replying to{" "}
            <span className="text-pulse-soft">
              {(replyTo.editedContent ?? replyTo.content).slice(0, 50)}
            </span>
          </span>
          <button
            onClick={() => setReplyTo(null)}
            className="ml-auto text-muted hover:text-body transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Edit banner */}
      {editingMessage && (
        <div className="flex items-center gap-2 border-t border-edge bg-panel px-4 py-2">
          <div className="h-4 w-0.5 rounded-full bg-amber-400" />
          <Pencil size={12} className="text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="text-xs text-soft">Editing message</span>
            <p className="text-xs text-muted truncate">
              {(editingMessage.editedContent ?? editingMessage.content).slice(0, 60)}
            </p>
          </div>
          <button
            onClick={() => setEditingMessage(null)}
            className="ml-auto text-muted hover:text-body transition-colors"
          >
            <X size={14} />
          </button>
        </div>
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
        editingMessage={editingMessage}
        onEditSubmit={handleEditSubmit}
        onEditCancel={() => setEditingMessage(null)}
      />
    </div>
  );
}
