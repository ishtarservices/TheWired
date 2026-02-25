import { Avatar } from "@/components/ui/Avatar";
import type { Kind0Profile } from "@/types/profile";

interface UserSearchResultItemProps {
  pubkey: string;
  profile: Kind0Profile;
  onClick: (pubkey: string) => void;
}

export function UserSearchResultItem({
  pubkey,
  profile,
  onClick,
}: UserSearchResultItemProps) {
  const name = profile.display_name || profile.name || pubkey.slice(0, 8) + "...";
  const secondary = profile.nip05 || pubkey.slice(0, 12) + "...";

  return (
    <button
      onClick={() => onClick(pubkey)}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-card-hover/30 transition-colors"
    >
      <Avatar src={profile.picture} alt={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-heading">{name}</p>
        <p className="truncate text-xs text-muted">{secondary}</p>
      </div>
    </button>
  );
}
