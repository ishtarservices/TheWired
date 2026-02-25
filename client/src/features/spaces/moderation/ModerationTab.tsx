import { Ban, Clock, X } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar";
import { Button } from "../../../components/ui/Button";
import { useProfile } from "../../profile/useProfile";
import { useModeration } from "./useModeration";

interface ModerationTabProps {
  spaceId: string;
}

function BanItem({ ban, onUnban }: { ban: { pubkey: string; reason?: string; bannedBy: string; expiresAt?: number; createdAt: string }; onUnban: () => void }) {
  const { profile } = useProfile(ban.pubkey);
  const { profile: moderatorProfile } = useProfile(ban.bannedBy);
  const name = profile?.display_name || profile?.name || ban.pubkey.slice(0, 12) + "...";
  const modName = moderatorProfile?.display_name || moderatorProfile?.name || ban.bannedBy.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-card/30 transition-colors">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-heading truncate">{name}</div>
        <div className="text-[10px] text-muted">
          {ban.reason && <span>Reason: {ban.reason} &middot; </span>}
          Banned by {modName}
          {ban.expiresAt && (
            <span> &middot; Expires {new Date(ban.expiresAt * 1000).toLocaleDateString()}</span>
          )}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onUnban} className="text-green-400 hover:bg-green-500/10">
        <X size={14} className="mr-1" />
        Unban
      </Button>
    </div>
  );
}

function MuteItem({ mute, onUnmute }: { mute: { id: string; pubkey: string; channelId?: string; mutedBy: string; expiresAt: number }; onUnmute: () => void }) {
  const { profile } = useProfile(mute.pubkey);
  const name = profile?.display_name || profile?.name || mute.pubkey.slice(0, 12) + "...";
  const remaining = Math.max(0, mute.expiresAt - Math.floor(Date.now() / 1000));
  const minutes = Math.ceil(remaining / 60);

  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-card/30 transition-colors">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-heading truncate">{name}</div>
        <div className="text-[10px] text-muted">
          {mute.channelId ? `Channel: ${mute.channelId}` : "Space-wide"}
          {" "}&middot; {minutes}m remaining
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onUnmute} className="text-green-400 hover:bg-green-500/10">
        <X size={14} className="mr-1" />
        Unmute
      </Button>
    </div>
  );
}

export function ModerationTab({ spaceId }: ModerationTabProps) {
  const { bans, mutes, unbanMember, unmuteMember } = useModeration(spaceId);

  return (
    <div className="space-y-6">
      {/* Bans */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Ban size={16} className="text-red-400" />
          <h3 className="text-sm font-semibold text-heading">Active Bans ({bans.length})</h3>
        </div>
        {bans.length === 0 ? (
          <p className="text-xs text-muted px-2">No active bans</p>
        ) : (
          <div className="space-y-0.5">
            {bans.map((ban) => (
              <BanItem
                key={ban.pubkey}
                ban={ban}
                onUnban={() => unbanMember(ban.pubkey)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mutes */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Clock size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-heading">Active Mutes ({mutes.length})</h3>
        </div>
        {mutes.length === 0 ? (
          <p className="text-xs text-muted px-2">No active mutes</p>
        ) : (
          <div className="space-y-0.5">
            {mutes.map((mute) => (
              <MuteItem
                key={mute.id}
                mute={mute}
                onUnmute={() => unmuteMember(mute.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
