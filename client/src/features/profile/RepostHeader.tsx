import { Repeat2 } from "lucide-react";
import { useProfile } from "./useProfile";

interface RepostHeaderProps {
  pubkey: string;
}

export function RepostHeader({ pubkey }: RepostHeaderProps) {
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-1.5 px-1 pb-1 text-xs text-green-400/80">
      <Repeat2 size={13} />
      <span>Reposted by <span className="font-medium">{name}</span></span>
    </div>
  );
}
