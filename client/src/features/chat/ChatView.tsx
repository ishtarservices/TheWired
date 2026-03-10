import { useEffect, useRef, useCallback } from "react";
import { ChatMessage } from "./ChatMessage";
import { ChatReply } from "./ChatReply";
import { ChatInput } from "./ChatInput";
import { useChat } from "./useChat";
import { useFileUpload } from "../../hooks/useFileUpload";
import { Spinner } from "../../components/ui/Spinner";
import { UnreadDivider } from "../../components/chat/UnreadDivider";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { clearUnreadDivider } from "../../store/slices/notificationSlice";
import { useUserPopover } from "../../features/profile/UserPopoverContext";
import { usePermissions } from "../../features/spaces/usePermissions";
import { RichContent } from "../../components/content/RichContent";
import { profileCache } from "../../lib/nostr/profileCache";
import { AlertCircle, RefreshCw, Lock } from "lucide-react";

export function ChatView() {
  const dispatch = useAppDispatch();
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const spaceMode = useAppSelector(
    (s) => s.spaces.list.find((sp) => sp.id === s.spaces.activeSpaceId)?.mode,
  );
  const memberPubkeys = useAppSelector(
    (s) => s.spaces.list.find((sp) => sp.id === s.spaces.activeSpaceId)?.memberPubkeys,
  );
  const { can, permissions } = usePermissions(activeSpaceId);
  const isReadOnly = spaceMode === "read";
  const permissionsLoaded = permissions.length > 0;
  const canSend = isLoggedIn && !isReadOnly && (!permissionsLoaded || can("SEND_MESSAGES"));
  const { openUserPopover } = useUserPopover();

  // File upload — owned here so dropZoneRef covers the entire chat view
  const upload = useFileUpload();

  // Unread divider: timestamp of old lastRead for this channel
  const dividerTimestamp = useAppSelector(
    (s) => activeChannelId ? s.notifications.unreadDividerTimestamps[activeChannelId] : undefined,
  );

  // Pre-warm member profiles so @-mention autocomplete has data
  useEffect(() => {
    if (memberPubkeys?.length) {
      profileCache.warmPubkeys(memberPubkeys);
    }
  }, [memberPubkeys]);
  const {
    messages,
    pendingMessages,
    replyTo,
    setReplyTo,
    sendMessage,
    retryMessage,
  } = useChat();

  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToUnread = useRef(false);

  // Find the index of the first unread message (for divider placement)
  const unreadStartIndex = dividerTimestamp !== undefined
    ? messages.findIndex((m) => m.created_at > dividerTimestamp)
    : -1;

  // Scroll to unread divider on first render, or to bottom if no unreads
  useEffect(() => {
    if (!scrollRef.current) return;

    if (dividerRef.current && !hasScrolledToUnread.current && unreadStartIndex > 0) {
      hasScrolledToUnread.current = true;
      dividerRef.current.scrollIntoView({ block: "center" });
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, pendingMessages.length, unreadStartIndex]);

  // Reset scroll tracking when channel changes
  useEffect(() => {
    hasScrolledToUnread.current = false;
  }, [activeChannelId]);

  const handleDividerFaded = useCallback(() => {
    if (activeChannelId) {
      dispatch(clearUnreadDivider(activeChannelId));
    }
  }, [dispatch, activeChannelId]);

  return (
    <div ref={upload.dropZoneRef} className="relative flex flex-1 flex-col overflow-hidden">
      {/* Drag overlay — covers the entire chat view */}
      {upload.dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-pulse/40 bg-pulse/[0.06] backdrop-blur-[1px]">
          <div className="rounded-xl bg-surface/80 px-6 py-4 text-center shadow-lg border border-pulse/20">
            <p className="text-sm font-medium text-pulse">Drop files to attach</p>
            <p className="mt-1 text-xs text-muted">Images, videos, audio, or PDFs</p>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {messages.length === 0 && pendingMessages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">
              No messages yet. Start the conversation!
            </p>
          </div>
        ) : (
          <>
            {messages.map((event, i) => (
              <div key={event.id}>
                {i === unreadStartIndex && (
                  <UnreadDivider ref={dividerRef} onFaded={handleDividerFaded} />
                )}
                <ChatMessage
                  event={event}
                  onReply={
                    isLoggedIn
                      ? (eventId, pubkey) => setReplyTo({ eventId, pubkey })
                      : undefined
                  }
                  onMentionClick={openUserPopover}
                />
              </div>
            ))}
            {pendingMessages.map((msg) => (
              <div
                key={msg.tempId}
                className="flex items-center gap-2 px-4 py-1.5 opacity-60"
              >
                <div className="min-w-0 flex-1 text-sm text-soft">
                  <RichContent content={msg.content} />
                </div>
                {msg.status === "pending" && <Spinner size="sm" />}
                {msg.status === "failed" && (
                  <div className="flex items-center gap-1">
                    <AlertCircle size={14} className="text-red-400" />
                    <button
                      onClick={() => retryMessage(msg.tempId)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {replyTo && (
        <ChatReply pubkey={replyTo.pubkey} onCancel={() => setReplyTo(null)} />
      )}

      {isReadOnly ? (
        <div className="flex items-center justify-center gap-2 border-t border-edge px-4 py-3 text-muted">
          <Lock size={14} />
          <span className="text-xs">This is a read-only space</span>
        </div>
      ) : (
        <ChatInput
          onSend={(content, mentions, attachments) => sendMessage(content, mentions, attachments)}
          disabled={!canSend}
          memberPubkeys={memberPubkeys}
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
      )}
    </div>
  );
}
