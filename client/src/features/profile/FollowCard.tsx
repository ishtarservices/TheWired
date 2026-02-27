import { useNavigate } from "react-router-dom";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "./useProfile";

interface FollowCardProps {
  pubkey: string;
}

export function FollowCard({ pubkey }: FollowCardProps) {
  const navigate = useNavigate();
  const { profile } = useProfile(pubkey);

  const displayName =
    profile?.display_name || profile?.name || pubkey.slice(0, 12) + "...";

  return (
    <button
      onClick={() => navigate(`/profile/${pubkey}`)}
      className="flex w-full items-center gap-3.5 card-glass p-4 rounded-xl text-left transition-all duration-150 hover-lift"
    >
      <Avatar src={profile?.picture} alt={displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-heading">
          {displayName}
        </div>
        <div className="truncate text-xs text-muted">
          {pubkey.slice(0, 16)}...
        </div>
      </div>
    </button>
  );
}
