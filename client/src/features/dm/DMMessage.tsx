import { useRef, useMemo, useState, useCallback, memo } from "react";
import { SmilePlus, Check, CheckCheck, AlertTriangle, Timer } from "lucide-react";
import { DM_EDIT_WINDOW_SECONDS } from "@ishtarservices/shared-types";
import { DMFileAttachment } from "./DMFileAttachment";
import { RichContent } from "@/components/content/RichContent";
import { Avatar } from "@/components/ui/Avatar";
import { ReactionPicker } from "@/components/chat/ReactionPicker";
import { ReactionPills } from "@/components/chat/ReactionPills";
import { useProfile } from "@/features/profile/useProfile";
import { useUserPopover } from "@/features/profile/UserPopoverContext";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useAppSelector } from "@/store/hooks";
import { matchEmbed } from "@/lib/content/embedPatterns";
import { DMMessageContextMenu } from "./DMMessageContextMenu";
import { getDisplayName, resolveDMReplyTarget, dmReactionPills } from "./dmUtils";
import type { DMMessage as DMMessageType } from "@/store/slices/dmSlice";

const URL_RE = /https?:\/\/\S+/;

interface DMMessageProps {
  message: DMMessageType;
  partnerPubkey: string;
  /** Whether the previous message was from the same sender (for visual grouping) */
  isGrouped: boolean;
  onEdit?: (message: DMMessageType) => void;
  onDeleteForEveryone?: (message: DMMessageType) => void;
  onReply?: (message: DMMessageType) => void;
  /** Add (remove=false) or remove (remove=true) our emoji reaction. */
  onReact?: (message: DMMessageType, emoji: string, remove: boolean) => void;
  /** All messages in the conversation, for looking up reply targets */
  allMessages?: DMMessageType[];
  onJumpToMessage?: (wrapId: string) => void;
  /** Room conversation: label other senders above their first bubble in a run. */
  isRoom?: boolean;
  /** Attachments from friends auto-decrypt; strangers' are click-to-load. */
  senderIsFriend?: boolean;
}

export const DMMessage = memo(function DMMessage({
  message,
  partnerPubkey,
  isGrouped,
  onEdit,
  onDeleteForEveryone,
  onReply,
  onReact,
  allMessages,
  onJumpToMessage,
  isRoom,
  senderIsFriend,
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
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // DM reactions are anchored on the rumor id — legacy rows without one can't
  // be reacted to cross-party, so the affordance is hidden for them.
  const canReact = !!onReact && !!message.rumorId && !message.isDeleted;
  const pills = useMemo(() => dmReactionPills(message.reactions, myPubkey), [message.reactions, myPubkey]);

  const handlePillToggle = useCallback(
    (emoji: string) => {
      if (!canReact || !myPubkey) return;
      const mine = !!message.reactions?.[emoji]?.includes(myPubkey);
      onReact!(message, emoji, mine);
    },
    [canReact, myPubkey, message, onReact],
  );

  const handlePickerSelect = useCallback(
    (emoji: string) => {
      if (!canReact || !myPubkey) return;
      // Picking an emoji you already set toggles it off, like chat.
      const mine = !!message.reactions?.[emoji]?.includes(myPubkey);
      onReact!(message, emoji, mine);
    },
    [canReact, myPubkey, message, onReact],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const displayName = getDisplayName(profile, message.senderPubkey);

  // Advisory edit window (docs/DM_WIRE_CONTRACT.md §2): 24 h, UI only.
  const canEdit = isMe && !message.isDeleted &&
    (Math.floor(Date.now() / 1000) - message.createdAt) <= DM_EDIT_WINDOW_SECONDS;
  const readCount = message.readBy?.length ?? 0;
  const deliveredCount = message.deliveredTo?.length ?? 0;

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
          <div className="rounded-2xl px-4 py-2 text-sm italic text-faint bg-surface border border-border rounded-bl-sm">
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
      <div className={`group/dm ${hasEmbed ? "max-w-[85%]" : "max-w-[70%]"} ${isMe ? "items-end" : "items-start"}`}>
        <div className={`flex items-center gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
          <div
            ref={bubbleRef}
            className={`rounded-2xl px-4 py-2 text-sm ${
              isMe
                ? "bg-primary-dim text-heading rounded-br-sm border border-primary/15"
                : "bg-card text-body rounded-bl-sm border border-border"
            }`}
          >
            {isRoom && !isMe && !isGrouped && (
              <div className="mb-0.5 text-[11px] font-medium text-primary-soft/80">{displayName}</div>
            )}
            {message.replyToWrapId && (
              <DMInlineReplyPreview
                replyToWrapId={message.replyToWrapId}
                allMessages={allMessages}
                onJump={onJumpToMessage}
              />
            )}
            {message.attachment ? (
              <DMFileAttachment meta={message.attachment} isMe={isMe} autoLoad={!!senderIsFriend} />
            ) : (
              <RichContent content={displayContent} emojiTags={message.emojiTags} onMentionClick={(pubkey, anchor) => openUserPopover(pubkey, anchor)} />
            )}
          </div>
          {/* Hover row: react */}
          {canReact && (
            <button
              type="button"
              onClick={() => setShowReactionPicker((v) => !v)}
              className="shrink-0 rounded-md p-1 text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-heading group-hover/dm:opacity-100 focus-visible:opacity-100"
              title="React"
              aria-label="React"
            >
              <SmilePlus size={14} />
            </button>
          )}
        </div>
        {showReactionPicker && canReact && (
          <ReactionPicker
            targetEventId={message.rumorId!}
            targetPubkey={message.senderPubkey}
            targetKind={14}
            anchorRef={bubbleRef}
            onClose={() => setShowReactionPicker(false)}
            onSelect={handlePickerSelect}
            unicodeOnly
          />
        )}
        <ReactionPills
          pills={pills}
          onToggle={canReact ? handlePillToggle : undefined}
          className={`mt-1 ${isMe ? "justify-end" : ""}`}
        />
        {!isGrouped && (
          <div
            className={`mt-0.5 flex items-center gap-1 text-[10px] text-faint ${isMe ? "justify-end" : "justify-start"}`}
          >
            <span>{timeAgo}</span>
            {message.editedContent && (
              <span className="italic">(edited)</span>
            )}
            {message.expiresAt !== undefined && (
              <span title="Disappearing message" className="inline-flex items-center"><Timer size={10} /></span>
            )}
            {isMe && message.syncWarning && (
              <span
                title="Not synced to your other devices — the copy for your own inbox failed to publish"
                className="inline-flex items-center text-amber-400"
                data-testid="dm-sync-warning"
              >
                <AlertTriangle size={10} />
              </span>
            )}
            {isMe && !message.syncWarning && (readCount > 0 || deliveredCount > 0) && (
              <span
                title={readCount > 0 ? "Read" : "Delivered"}
                className={`inline-flex items-center ${readCount > 0 ? "text-primary" : ""}`}
                data-testid={readCount > 0 ? "dm-read" : "dm-delivered"}
              >
                {readCount > 0 ? <CheckCheck size={11} /> : <Check size={11} />}
              </span>
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
        content={message.attachment ? message.attachment.url : displayContent}
        isOwnMessage={isMe}
        canEdit={canEdit}
        onEdit={() => onEdit?.(message)}
        onDeleteForEveryone={() => onDeleteForEveryone?.(message)}
        onReply={onReply ? () => onReply(message) : undefined}
        onReact={canReact ? () => setShowReactionPicker(true) : undefined}
      />
    </div>
  );
});

/** Inline preview of the DM being replied to. `replyToWrapId` is the rumor's
 *  `q` value — a rumorId from current clients, a wrapId from older ones — so it
 *  is resolved rumorId-first, wrapId-fallback, and the jump targets the
 *  resolved message's own wrapId (the DOM anchor). */
function DMInlineReplyPreview({
  replyToWrapId,
  allMessages,
  onJump,
}: {
  replyToWrapId: string;
  allMessages?: DMMessageType[];
  onJump?: (wrapId: string) => void;
}) {
  const replyMsg = resolveDMReplyTarget(allMessages, replyToWrapId);
  const { profile } = useProfile(replyMsg?.senderPubkey ?? "");

  if (!replyMsg) {
    return (
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <div className="h-3 w-0.5 rounded-full bg-border-light" />
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
      onClick={() => onJump?.(replyMsg.wrapId)}
      className="mb-1 flex items-center gap-1.5 text-[11px] text-muted overflow-hidden cursor-pointer hover:opacity-80 transition-opacity w-full text-left"
    >
      <div className="h-3 w-0.5 shrink-0 rounded-full bg-primary/50" />
      <span className="font-medium text-primary-soft/70 shrink-0">{name}</span>
      <span className="truncate">{preview}</span>
    </button>
  );
}
