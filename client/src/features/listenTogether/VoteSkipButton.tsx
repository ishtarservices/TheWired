import { SkipForward } from "lucide-react";
import { useListenTogether } from "./useListenTogether";

/**
 * Vote-skip button that shows the current vote count and triggers skip
 * when the threshold (>50% of listeners) is reached.
 */
export function VoteSkipButton() {
  const { active, isLocalDJ, voteSkip, skipVotes, listenerCount } = useListenTogether();

  if (!active || isLocalDJ) return null;

  const threshold = Math.ceil(listenerCount / 2);

  return (
    <button
      onClick={voteSkip}
      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-soft hover:text-heading bg-surface hover:bg-surface-hover transition-colors"
      title="Vote to skip this track"
    >
      <SkipForward size={12} />
      <span>Skip</span>
      {skipVotes.length > 0 && (
        <span className="text-muted">
          {skipVotes.length}/{threshold}
        </span>
      )}
    </button>
  );
}
