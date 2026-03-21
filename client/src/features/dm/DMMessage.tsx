import { useRef, useMemo, useState, useCallback, memo } from "react";
import { RichContent } from "@/components/content/RichContent";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useUserPopover } from "@/features/profile/UserPopoverContext";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useAppSelector } from "@/store/hooks";
import { matchEmbed } from "@/lib/content/embedPatterns";
import { DMMessageContextMenu } from "./DMMessageContextMenu";
import { getDisplayName } from "./dmUtils";
import type { DMMessage as DMMessageType } from "@/store/slices/dmSlice";

const URL_RE = /https?:\/\/\S+/;

/** 15 minutes in seconds */
const EDIT_WINDOW_SECONDS = 15 * 60;

interface DMMessageProps {
  message: DMMessageType;
  partnerPubkey: string;
  /** Whether the previous message was from the same sender (for visual grouping) */
  isGrouped: boolean;
  onEdit?: (message: DMMessageType) => void;
  onDeleteForEveryone?: (message: DMMessageType) => void;
  onReply?: (message: DMMessageType) => void;
  /** All messages in the conversation, for looking up reply targets */
  allMessages?: DMMessageType[];
  onJumpToMessage?: (wrapId: string) => void;
}

export const DMMessage = memo(function DMMessage({
  message,
  partnerPubkey,
  isGrouped,
  onEdit,
  onDeleteForEveryone,
  onReply,
  allMessages,
  onJumpToMessage,
}: DMMessageProps) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isMe = message.senderPubkey === myPubkey;
  const { profile } = useProfile(message.senderPubkey);
  const { openUserPopover } = useUserPopover();
  const timeAgo = useRelativeTime(message.createdAt, true);
  const avatarRef = useRef<HTMLButtonElement>(null);

  const displayContent = message.isDeleted
    ? ""
    : (message.editedContent ?? message.content);

  const hasEmbed = useMemo(() => {
    if (message.isDeleted) return false;
    const urlMatch = displayContent.match(URL_RE);
    return urlMatch ? !!matchEmbed(urlMatch[0]) : false;
  }, [displayContent, message.isDeleted]);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const displayName = getDisplayName(profile, message.senderPubkey);

  // Edit window check
  const canEdit = isMe && !message.isDeleted &&
    (Math.floor(Date.now() / 1000) - message.createdAt) <= EDIT_WINDOW_SECONDS;

  // Deleted message placeholder
  if (message.isDeleted) {
    return (
      <div
        className={`flex gap-3 px-4 ${isGrouped ? "py-0.5" : "py-2"} ${isMe ? "flex-row-reverse" : ""}`}
      >
        {!isMe && (
          isGrouped ? (
            <div className="w-8 shrink-0" />
          ) : (
            <div className="mt-0.5 shrink-0">
              <Avatar src={profile?.picture} alt={displayName} size="sm" />
            </div>
          )
        )}
        <div className={`max-w-[70%] ${isMe ? "items-end" : "items-start"}`}>
          <div className="rounded-2xl px-4 py-2 text-sm italic text-faint bg-surface border border-edge rounded-bl-sm">
            Message deleted
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex gap-3 px-4 ${isGrouped ? "py-0.5" : "py-2"} ${isMe ? "flex-row-reverse" : ""}`}
      onContextMenu={handleContextMenu}
    >
      {!isMe && (
        isGrouped ? (
          /* Invisible spacer to keep alignment with non-grouped messages */
          <div className="w-8 shrink-0" />
        ) : (
          <button
            ref={avatarRef}
            type="button"
            onClick={() => {
              if (avatarRef.current) openUserPopover(message.senderPubkey, avatarRef.current);
            }}
            className="cursor-pointer shrink-0 mt-0.5"
          >
            <Avatar src={profile?.picture} alt={displayName} size="sm" />
          </button>
        )
      )}
      <div className={`${hasEmbed ? "max-w-[85%]" : "max-w-[70%]"} ${isMe ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-2 text-sm ${
            isMe
              ? "bg-pulse-dim text-heading rounded-br-sm border border-pulse/15"
              : "bg-card text-body rounded-bl-sm border border-edge"
          }`}
        >
          {message.replyToWrapId && (
            <DMInlineReplyPreview
              replyToWrapId={message.replyToWrapId}
              allMessages={allMessages}
              onJump={onJumpToMessage}
            />
          )}
          <RichContent content={displayContent} onMentionClick={(pubkey, anchor) => openUserPopover(pubkey, anchor)} />
        </div>
        {!isGrouped && (
          <div
            className={`mt-0.5 flex items-center gap-1 text-[10px] text-faint ${isMe ? "justify-end" : "justify-start"}`}
          >
            <span>{timeAgo}</span>
            {message.editedContent && (
              <span className="italic">(edited)</span>
            )}
          </div>
        )}
      </div>
      <DMMessageContextMenu
        open={!!ctxMenu}
        onClose={() => setCtxMenu(null)}
        position={ctxMenu ?? { x: 0, y: 0 }}
        partnerPubkey={partnerPubkey}
        wrapId={message.wrapId}
        content={displayContent}
        isOwnMessage={isMe}
        canEdit={canEdit}
        onEdit={() => onEdit?.(message)}
        onDeleteForEveryone={() => onDeleteForEveryone?.(message)}
        onReply={onReply ? () => onReply(message) : undefined}
      />
    </div>
  );
});

/** Inline preview of the DM being replied to */
function DMInlineReplyPreview({
  replyToWrapId,
  allMessages,
  onJump,
}: {
  replyToWrapId: string;
  allMessages?: DMMessageType[];
  onJump?: (wrapId: string) => void;
}) {
  const replyMsg = allMessages?.find((m) => m.wrapId === replyToWrapId);
  const { profile } = useProfile(replyMsg?.senderPubkey ?? "");

  if (!replyMsg) {
    return (
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <div className="h-3 w-0.5 rounded-full bg-edge-light" />
        <span className="italic">Message not loaded</span>
      </div>
    );
  }

  const name = getDisplayName(profile, replyMsg.senderPubkey);
  const content = replyMsg.editedContent ?? replyMsg.content;
  const preview = content.length > 60 ? content.slice(0, 60) + "..." : content;

  return (
    <button
      type="button"
      onClick={() => onJump?.(replyToWrapId)}
      className="mb-1 flex items-center gap-1.5 text-[11px] text-muted overflow-hidden cursor-pointer hover:opacity-80 transition-opacity w-full text-left"
    >
      <div className="h-3 w-0.5 shrink-0 rounded-full bg-pulse/50" />
      <span className="font-medium text-pulse-soft/70 shrink-0">{name}</span>
      <span className="truncate">{preview}</span>
    </button>
  );
}
