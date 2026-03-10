import { useEffect, useRef, useCallback } from "react";
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
import { ArrowLeft } from "lucide-react";

interface DMConversationProps {
  partnerPubkey: string;
  onBack: () => void;
}

export function DMConversation({ partnerPubkey, onBack }: DMConversationProps) {
  const dispatch = useAppDispatch();
  const messages = useDMConversation(partnerPubkey);
  const { profile } = useProfile(partnerPubkey);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToUnread = useRef(false);

  // File upload — owned here so dropZoneRef covers the entire DM view
  const upload = useFileUpload();

  // Unread divider: count captured by setActiveConversation before clearing
  const unreadCount = useAppSelector(
    (s) => s.dm.unreadDividers[partnerPubkey],
  );

  const displayName =
    profile?.display_name || profile?.name || partnerPubkey.slice(0, 8) + "...";

  // Compute divider position: insert before the first unread message
  const dividerIndex = unreadCount && unreadCount > 0 && messages.length > 0
    ? Math.max(0, messages.length - unreadCount)
    : -1;

  // Scroll to unread divider on first render, or to bottom if no unreads
  useEffect(() => {
    if (!scrollRef.current) return;

    if (dividerRef.current && !hasScrolledToUnread.current && dividerIndex > 0) {
      hasScrolledToUnread.current = true;
      dividerRef.current.scrollIntoView({ block: "center" });
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, dividerIndex]);

  // Reset scroll tracking when partner changes
  useEffect(() => {
    hasScrolledToUnread.current = false;
  }, [partnerPubkey]);

  // Mark as read — sync both DM unread count and notification bell
  useEffect(() => {
    dispatch(markConversationRead(partnerPubkey));
    dispatch(markDMNotificationsRead(partnerPubkey));
  }, [partnerPubkey, dispatch]);

  const handleDividerFaded = useCallback(() => {
    dispatch(clearDMUnreadDivider(partnerPubkey));
  }, [dispatch, partnerPubkey]);

  const handleSend = useCallback(
    async (content: string) => {
      try {
        await sendDM(partnerPubkey, content);
      } catch (err) {
        console.error("Failed to send DM:", err);
      }
    },
    [partnerPubkey],
  );

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
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
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
          messages.map((msg, i) => (
            <div key={msg.wrapId}>
              {i === dividerIndex && (
                <UnreadDivider ref={dividerRef} onFaded={handleDividerFaded} />
              )}
              <DMMessage message={msg} />
            </div>
          ))
        )}
      </div>

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
