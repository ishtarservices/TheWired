import { MessageSquare } from "lucide-react";
import type { NostrEvent } from "../../types/nostr";

interface NoteCardProps {
  event: NostrEvent;
}

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export function NoteCard({ event }: NoteCardProps) {
  const isReply = event.tags.some(
    (t) => t[0] === "e" && (t[3] === "reply" || t[3] === "root"),
  );

  return (
    <div className="card-glass p-5 rounded-xl hover-lift transition-all duration-150">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <span>{formatRelativeTime(event.created_at)}</span>
        {isReply && (
          <span className="flex items-center gap-1 text-faint">
            <MessageSquare size={12} />
            reply
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-heading">
        {event.content}
      </p>
    </div>
  );
}
