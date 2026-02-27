import { memo } from "react";
import { MessageCircle, Repeat2, Heart, Quote } from "lucide-react";
import type { NoteEngagement } from "../useNoteEngagement";

interface NoteActionBarProps {
  engagement: NoteEngagement;
  canInteract: boolean;
  canWrite: boolean;
  onReply: () => void;
  onRepost: () => void;
  onLike: () => void;
  onQuote: () => void;
}

function formatCount(n: number): string {
  if (n === 0) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const NoteActionBar = memo(function NoteActionBar({
  engagement,
  canInteract,
  canWrite,
  onReply,
  onRepost,
  onLike,
  onQuote,
}: NoteActionBarProps) {
  return (
    <div className="mt-2 flex items-center gap-8">
      {/* Reply */}
      <button
        onClick={onReply}
        disabled={!canWrite}
        className="group flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <MessageCircle size={16} className="group-hover:text-blue-400" />
        <span>{formatCount(engagement.replyCount)}</span>
      </button>

      {/* Repost */}
      <button
        onClick={onRepost}
        disabled={!canWrite}
        className={`group flex items-center gap-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          engagement.reposted
            ? "text-green-400"
            : "text-muted hover:text-green-400"
        }`}
      >
        <Repeat2 size={16} />
        <span>{formatCount(engagement.repostCount)}</span>
      </button>

      {/* Like */}
      <button
        onClick={onLike}
        disabled={!canInteract}
        className={`group flex items-center gap-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          engagement.liked
            ? "text-pink-400"
            : "text-muted hover:text-pink-400"
        }`}
      >
        <Heart
          size={16}
          fill={engagement.liked ? "currentColor" : "none"}
        />
        <span>{formatCount(engagement.reactionCount)}</span>
      </button>

      {/* Quote */}
      <button
        onClick={onQuote}
        disabled={!canWrite}
        className="group flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-neon disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Quote size={16} className="group-hover:text-neon" />
        <span>{formatCount(engagement.quoteCount)}</span>
      </button>
    </div>
  );
});
