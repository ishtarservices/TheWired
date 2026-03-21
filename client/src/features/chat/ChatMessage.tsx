import { useRef, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { Avatar } from "../../components/ui/Avatar";
import { RichContent } from "../../components/content/RichContent";
import { BlockedMessage } from "../../components/ui/BlockedMessage";
import { ChatMessageContextMenu } from "./ChatMessageContextMenu";
import { useProfile } from "../profile/useProfile";
import { useIsBlocked } from "../../hooks/useIsBlocked";
import { useUnblock } from "../../hooks/useUnblock";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import type { NostrEvent } from "../../types/nostr";

interface ChatMessageProps {
  event: NostrEvent;
  displayContent: string;
  isEdited: boolean;
  isOwnMessage: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  /** Whether the logged-in user is @mentioned in this message */
  isMentioned?: boolean;
  onReply?: (eventId: string, pubkey: string) => void;
  onMentionClick?: (pubkey: string, anchor: HTMLElement) => void;
  onDeleteForMe: (eventId: string) => void;
  onDeleteForEveryone: (eventId: string) => void;
  onModDelete: (eventId: string) => void;
  onEdit: (event: NostrEvent) => void;
  onJumpToMessage?: (eventId: string) => void;
}

export function ChatMessage({
  event,
  displayContent,
  isEdited,
  isOwnMessage,
  isAdmin,
  canEdit,
  isMentioned,
  onReply,
  onMentionClick,
  onDeleteForMe,
  onDeleteForEveryone,
  onModDelete,
  onEdit,
  onJumpToMessage,
}: ChatMessageProps) {
  const { profile } = useProfile(event.pubkey);
  const isBlocked = useIsBlocked(event.pubkey);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const displayName =
    profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const timeAgo = formatDistanceToNow(event.created_at * 1000, {
    addSuffix: true,
  });

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Extract reply context from q-tag
  const replyEventId = event.tags.find((t) => t[0] === "q")?.[1];

  const unblock = useUnblock(event.pubkey);

  if (isBlocked) {
    return (
      <BlockedMessage variant="chat" onUnblock={unblock}>
        <div className="group flex gap-3.5 px-5 py-2">
          <button
            ref={avatarRef}
            type="button"
            onClick={() => {
              if (onMentionClick && avatarRef.current)
                onMentionClick(event.pubkey, avatarRef.current);
            }}
            className="mt-0.5 shrink-0 cursor-pointer"
          >
            <Avatar src={profile?.picture} alt={displayName} size="sm" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-pulse-soft">{displayName}</span>
              <span className="text-xs text-muted">{timeAgo}</span>
            </div>
            <div className="text-sm text-body break-words">
              <RichContent content={displayContent} onMentionClick={onMentionClick} />
            </div>
          </div>
        </div>
      </BlockedMessage>
    );
  }

  return (
    <div
      className={`group flex gap-3.5 px-5 py-2 hover:bg-surface transition-colors duration-100 ${
        isMentioned ? "bg-pulse/[0.06] border-l-2 border-l-pulse/50" : ""
      }`}
      onContextMenu={handleContextMenu}
    >
      <button
        ref={avatarRef}
        type="button"
        onClick={() => {
          if (onMentionClick && avatarRef.current)
            onMentionClick(event.pubkey, avatarRef.current);
        }}
        className="mt-0.5 shrink-0 cursor-pointer"
      >
        <Avatar src={profile?.picture} alt={displayName} size="sm" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-pulse-soft">
            {displayName}
          </span>
          <span className="text-xs text-muted">{timeAgo}</span>
          {isEdited && (
            <span className="text-[10px] text-faint italic">(edited)</span>
          )}
          {onReply && (
            <button
              onClick={() => onReply(event.id, event.pubkey)}
              className="ml-auto text-xs text-muted opacity-0 transition-opacity hover:text-pulse-soft group-hover:opacity-100"
            >
              Reply
            </button>
          )}
        </div>
        {replyEventId && <InlineReplyPreview eventId={replyEventId} onJump={onJumpToMessage} />}
        <div className="text-sm text-body break-words">
          <RichContent content={displayContent} onMentionClick={onMentionClick} />
        </div>
      </div>
      <ChatMessageContextMenu
        open={!!ctxMenu}
        onClose={() => setCtxMenu(null)}
        position={ctxMenu ?? { x: 0, y: 0 }}
        content={displayContent}
        isOwnMessage={isOwnMessage}
        isAdmin={isAdmin}
        canEdit={canEdit}
        onDeleteForMe={() => onDeleteForMe(event.id)}
        onDeleteForEveryone={() => onDeleteForEveryone(event.id)}
        onModDelete={() => onModDelete(event.id)}
        onEdit={() => onEdit(event)}
      />
    </div>
  );
}

/** Compact inline preview of the message being replied to */
function InlineReplyPreview({ eventId, onJump }: { eventId: string; onJump?: (eventId: string) => void }) {
  const replyEvent = useAppSelector((s) => eventsSelectors.selectById(s.events, eventId));
  const { profile } = useProfile(replyEvent?.pubkey);
  const isBlocked = useIsBlocked(replyEvent?.pubkey ?? "");

  if (!replyEvent) {
    return (
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <div className="h-3 w-0.5 rounded-full bg-edge-light" />
        <span className="italic">Message not loaded</span>
      </div>
    );
  }

  if (isBlocked) {
    return (
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted overflow-hidden">
        <div className="h-3 w-0.5 shrink-0 rounded-full bg-edge-light" />
        <span className="italic">Blocked message</span>
      </div>
    );
  }

  const name = profile?.display_name || profile?.name || replyEvent.pubkey.slice(0, 8) + "...";
  // Strip nostr: references (npub, nevent, naddr, note) from the preview text
  const cleanContent = replyEvent.content.replace(/nostr:(npub|nevent|naddr|note)1[a-z0-9]+/g, "").replace(/\s{2,}/g, " ").trim();
  const preview = cleanContent.length > 80
    ? cleanContent.slice(0, 80) + "..."
    : cleanContent;

  return (
    <button
      type="button"
      onClick={() => onJump?.(eventId)}
      className="mb-1 flex items-center gap-1.5 text-[11px] text-muted overflow-hidden cursor-pointer hover:bg-surface-hover rounded px-1 -ml-1 py-0.5 transition-colors"
    >
      <div className="h-3 w-0.5 shrink-0 rounded-full bg-pulse/50" />
      <span className="font-medium text-pulse-soft/70 shrink-0">{name}</span>
      <span className="truncate">{preview}</span>
    </button>
  );
}
