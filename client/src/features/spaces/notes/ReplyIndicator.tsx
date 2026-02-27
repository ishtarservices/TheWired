import { CornerDownRight } from "lucide-react";
import { useProfile } from "../../profile/useProfile";

interface ReplyIndicatorProps {
  pubkey: string;
}

export function ReplyIndicator({ pubkey }: ReplyIndicatorProps) {
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted/70">
      <CornerDownRight size={12} />
      <span>Replying to</span>
      <span className="text-neon">{name}</span>
    </div>
  );
}
