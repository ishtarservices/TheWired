import { memo } from "react";
import { useAppSelector } from "@/store/hooks";
import type { ReactionPill } from "@/store/slices/reactionsSlice";

interface ReactionPillsProps {
  pills: ReactionPill[];
  /** Tap handler — same emoji you already set = un-react, otherwise add. */
  onToggle?: (content: string) => void;
  className?: string;
}

/**
 * The emoji-pill row under a chat or DM message. Pills you reacted with are
 * highlighted; tapping a pill toggles that emoji for you (when `onToggle` is
 * given), matching the mobile client. Custom `:shortcode:` reactions render via
 * the NIP-30 shortcode index.
 */
export const ReactionPills = memo(function ReactionPills({
  pills,
  onToggle,
  className = "",
}: ReactionPillsProps) {
  if (pills.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {pills.map(({ content, count, mine }) => (
        <button
          key={content}
          type="button"
          onClick={onToggle ? () => onToggle(content) : undefined}
          disabled={!onToggle}
          aria-pressed={mine}
          title={mine ? "Remove your reaction" : "React"}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border transition-colors ${
            mine
              ? "bg-primary/15 border-primary/50 text-heading"
              : "bg-surface-hover border-border text-body"
          } ${onToggle ? "cursor-pointer hover:border-primary/40" : "cursor-default"}`}
        >
          {content.startsWith(":") && content.endsWith(":") ? (
            <ReactionEmoji shortcode={content} />
          ) : (
            <span>{content}</span>
          )}
          {count > 1 && <span className="text-muted">{count}</span>}
        </button>
      ))}
    </div>
  );
});

/** Render a custom emoji reaction shortcode via the NIP-30 shortcode index */
function ReactionEmoji({ shortcode }: { shortcode: string }) {
  const shortcodeIndex = useAppSelector((s) => s.emoji.shortcodeIndex);
  const clean = shortcode.replace(/^:|:$/g, "");
  const emoji = shortcodeIndex[clean];

  if (emoji) {
    return (
      <img
        src={emoji.url}
        alt={shortcode}
        className="inline-block h-4 w-4 object-contain"
      />
    );
  }
  return <span>{shortcode}</span>;
}
