import { memo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar";
import { useProfile } from "../../profile/useProfile";
import { useNoteThread } from "../useNoteThread";
import { ReplyIndicator } from "./ReplyIndicator";
import { parseThreadRef } from "../noteParser";
import type { NostrEvent } from "../../../types/nostr";

interface ThreadViewProps {
  eventId: string;
  expanded: boolean;
  onToggle: () => void;
}

const ThreadReply = memo(function ThreadReply({ event, rootId }: { event: NostrEvent; rootId: string }) {
  const { profile } = useProfile(event.pubkey);
  const name = profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const date = new Date(event.created_at * 1000);
  const timeStr = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const threadRef = parseThreadRef(event);
  const isNestedReply = threadRef.replyId !== null && threadRef.replyId !== rootId;

  return (
    <div className="border-l-2 border-edge/30 pl-3 py-2">
      {isNestedReply && threadRef.mentionedPubkeys[0] && (
        <ReplyIndicator pubkey={threadRef.mentionedPubkeys[0]} />
      )}
      <div className="flex items-center gap-2 mb-1">
        <Avatar src={profile?.picture} alt={name} size="xs" />
        <span className="text-xs font-medium text-heading">{name}</span>
        <span className="text-xs text-muted">{timeStr}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-body">
        {event.content}
      </p>
    </div>
  );
});

export const ThreadView = memo(function ThreadView({
  eventId,
  expanded,
  onToggle,
}: ThreadViewProps) {
  const { replies, replyCount } = useNoteThread(eventId, expanded);

  if (replyCount === 0 && !expanded) return null;

  return (
    <div className="mt-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-xs text-soft transition-colors hover:text-heading"
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>
          {expanded
            ? "Hide replies"
            : `Show ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
        </span>
      </button>

      {expanded && replies.length > 0 && (
        <div className="mt-2 space-y-1">
          {replies.map((reply) => (
            <ThreadReply key={reply.id} event={reply} rootId={eventId} />
          ))}
        </div>
      )}
    </div>
  );
});
