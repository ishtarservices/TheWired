import { memo } from "react";
import { MessageCircle, Repeat2, Heart, Quote, Share, Pin, Zap, Sparkles } from "lucide-react";
import type { NoteEngagement } from "../useNoteEngagement";

interface NoteActionBarProps {
  engagement: NoteEngagement;
  canInteract: boolean;
  canWrite: boolean;
  onReply: () => void;
  onRepost: () => void;
  onLike: () => void;
  onQuote: () => void;
  onShare?: () => void;
  /** Zap action — sends a NIP-57 lightning zap to the note author */
  onZap?: () => void;
  /** Pin action — only shown on the user's own root notes */
  showPin?: boolean;
  isPinned?: boolean;
  onPin?: () => void;
  /** Ask AI — summarize this note/thread (shown only when the AI feature is on) */
  onAskAI?: () => void;
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
  onShare,
  onZap,
  showPin,
  isPinned,
  onPin,
  onAskAI,
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
        className="group flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Quote size={16} className="group-hover:text-primary" />
        <span>{formatCount(engagement.quoteCount)}</span>
      </button>

      {/* Zap */}
      {onZap && (
        <button
          onClick={onZap}
          disabled={!canInteract}
          className="group flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
          title="Zap"
        >
          <Zap size={16} className="group-hover:text-yellow-400" />
        </button>
      )}

      {/* Ask AI */}
      {onAskAI && (
        <button
          onClick={onAskAI}
          className="group flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-primary"
          title="Ask AI about this thread"
        >
          <Sparkles size={16} className="group-hover:text-primary" />
        </button>
      )}

      {/* Share */}
      {onShare && (
        <button
          onClick={onShare}
          disabled={!canInteract}
          className="group flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Share size={16} className="group-hover:text-primary" />
        </button>
      )}

      {/* Pin */}
      {showPin && onPin && (
        <button
          onClick={onPin}
          className={`group flex items-center gap-1.5 text-xs transition-colors ${
            isPinned
              ? "text-primary"
              : "text-muted hover:text-primary"
          }`}
          title={isPinned ? "Unpin from profile" : "Pin to profile"}
        >
          <Pin
            size={16}
            className="rotate-45"
            fill={isPinned ? "currentColor" : "none"}
          />
        </button>
      )}
    </div>
  );
});
