import { Headphones } from "lucide-react";
import { useListenTogether } from "./useListenTogether";

/**
 * Badge shown on existing playback bar components when a Listen Together
 * session is active. Shows listener count and indicates DJ vs follower status.
 */
export function ListenTogetherBadge() {
  const { active, listenerCount, isLocalDJ } = useListenTogether();

  if (!active) return null;

  return (
    <span
      className="flex items-center gap-1 rounded-full bg-pulse/10 px-2 py-0.5 text-[10px] text-pulse shrink-0"
      title={
        isLocalDJ
          ? `You are the DJ — ${listenerCount} listening`
          : "DJ is controlling playback"
      }
    >
      <Headphones size={10} />
      {listenerCount} listening
    </span>
  );
}
