import { useState } from "react";
import { Repeat2, X } from "lucide-react";
import { useProfile } from "./useProfile";

interface RepostHeaderProps {
  pubkey: string;
  /** When provided, shows an unrepost button on hover */
  onUnrepost?: () => void;
}

export function RepostHeader({ pubkey, onUnrepost }: RepostHeaderProps) {
  const { profile } = useProfile(pubkey);
  const [confirming, setConfirming] = useState(false);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="group/repost flex items-center gap-1.5 px-1 pb-1 text-xs text-green-400/80">
      <Repeat2 size={13} />
      <span className="flex-1">Reposted by <span className="font-medium">{name}</span></span>
      {onUnrepost && !confirming && (
        <button
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted opacity-0 group-hover/repost:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title="Undo repost"
        >
          <X size={11} />
          <span>Undo</span>
        </button>
      )}
      {onUnrepost && confirming && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted">Remove repost?</span>
          <button
            onClick={() => {
              setConfirming(false);
              onUnrepost();
            }}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-hover transition-colors"
          >
            No
          </button>
        </div>
      )}
    </div>
  );
}
