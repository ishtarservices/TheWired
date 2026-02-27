import { X } from "lucide-react";
import { useProfile } from "../profile/useProfile";

interface ChatReplyProps {
  pubkey: string;
  onCancel: () => void;
}

export function ChatReply({ pubkey, onCancel }: ChatReplyProps) {
  const { profile } = useProfile(pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-2 border-t border-white/[0.04] bg-panel px-4 py-2">
      <div className="h-4 w-0.5 rounded-full bg-pulse" />
      <span className="text-xs text-soft">
        Replying to <span className="text-pulse-soft">{name}</span>
      </span>
      <button
        onClick={onCancel}
        className="ml-auto text-muted hover:text-body transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
