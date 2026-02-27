import { formatDistanceToNow } from "date-fns";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import type { NostrEvent } from "../../types/nostr";

interface ChatMessageProps {
  event: NostrEvent;
  onReply?: (eventId: string, pubkey: string) => void;
}

export function ChatMessage({ event, onReply }: ChatMessageProps) {
  const { profile } = useProfile(event.pubkey);
  const displayName =
    profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const timeAgo = formatDistanceToNow(event.created_at * 1000, {
    addSuffix: true,
  });

  return (
    <div className="group flex gap-3.5 px-5 py-2 hover:bg-white/[0.02] transition-colors duration-100">
      <Avatar src={profile?.picture} alt={displayName} size="sm" className="mt-0.5 shrink-0" />
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
        <p className="text-sm text-body break-words">{event.content}</p>
      </div>
    </div>
  );
}
