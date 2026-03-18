import { useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { Avatar } from "../../components/ui/Avatar";
import { RichContent } from "../../components/content/RichContent";
import { useProfile } from "../profile/useProfile";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import type { NostrEvent } from "../../types/nostr";

interface ChatMessageProps {
  event: NostrEvent;
  onReply?: (eventId: string, pubkey: string) => void;
  onMentionClick?: (pubkey: string, anchor: HTMLElement) => void;
}

export function ChatMessage({ event, onReply, onMentionClick }: ChatMessageProps) {
  const { profile } = useProfile(event.pubkey);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const displayName =
    profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const timeAgo = formatDistanceToNow(event.created_at * 1000, {
    addSuffix: true,
  });

  // Extract reply context from q-tag
  const replyEventId = event.tags.find((t) => t[0] === "q")?.[1];

  return (
    <div className="group flex gap-3.5 px-5 py-2 hover:bg-surface transition-colors duration-100">
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
          {onReply && (
            <button
              onClick={() => onReply(event.id, event.pubkey)}
              className="ml-auto text-xs text-muted opacity-0 transition-opacity hover:text-pulse-soft group-hover:opacity-100"
            >
              Reply
            </button>
          )}
        </div>
        {replyEventId && <InlineReplyPreview eventId={replyEventId} />}
        <div className="text-sm text-body break-words">
          <RichContent content={event.content} onMentionClick={onMentionClick} />
        </div>
      </div>
    </div>
  );
}

/** Compact inline preview of the message being replied to */
function InlineReplyPreview({ eventId }: { eventId: string }) {
  const replyEvent = useAppSelector((s) => eventsSelectors.selectById(s.events, eventId));
  const { profile } = useProfile(replyEvent?.pubkey);

  if (!replyEvent) {
    return (
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
        <div className="h-3 w-0.5 rounded-full bg-edge-light" />
        <span className="italic">Message not loaded</span>
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
    <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted overflow-hidden">
      <div className="h-3 w-0.5 shrink-0 rounded-full bg-pulse/50" />
      <span className="font-medium text-pulse-soft/70 shrink-0">{name}</span>
      <span className="truncate">{preview}</span>
    </div>
  );
}
