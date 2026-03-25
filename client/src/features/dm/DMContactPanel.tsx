import { useMemo } from "react";
import { Phone, Video, VolumeX, Ban, UserCheck, UserPlus, Clock } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "../profile/useProfile";

export function DMContactPanel() {
  const activePubkey = useAppSelector((s) => s.dm.activeConversation);
  const { profile } = useProfile(activePubkey);
  const friendRequests = useAppSelector((s) => s.friendRequests.requests);
  const muteList = useAppSelector((s) => s.identity.muteList);

  const friendStatus = useMemo(() => {
    if (!activePubkey) return null;
    const req = friendRequests.find(
      (r) => r.pubkey === activePubkey && r.status === "accepted",
    );
    if (req) return "friend" as const;
    const pending = friendRequests.find(
      (r) => r.pubkey === activePubkey && r.status === "pending",
    );
    if (pending) return "pending" as const;
    return null;
  }, [activePubkey, friendRequests]);

  const isMuted = useMemo(
    () =>
      muteList.some(
        (m) => m.type === "pubkey" && m.value === activePubkey,
      ),
    [muteList, activePubkey],
  );

  if (!activePubkey) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-soft">Select a conversation</p>
      </div>
    );
  }

  const displayName =
    profile?.display_name || profile?.name || activePubkey.slice(0, 12) + "...";

  return (
    <div className="space-y-5 p-4">
      {/* Profile card */}
      <div className="flex flex-col items-center text-center">
        <Avatar src={profile?.picture} size="lg" />
        <h3 className="mt-3 text-sm font-semibold text-heading truncate max-w-full">
          {displayName}
        </h3>
        {profile?.nip05 && (
          <p className="text-[11px] text-primary truncate max-w-full">
            {profile.nip05}
          </p>
        )}
        {friendStatus === "friend" && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
            <UserCheck size={10} />
            Friend
          </span>
        )}
        {friendStatus === "pending" && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
            <Clock size={10} />
            Pending
          </span>
        )}
        {!friendStatus && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">
            <UserPlus size={10} />
            Not friends
          </span>
        )}
      </div>

      {/* About */}
      {profile?.about && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
            About
          </h4>
          <p className="text-xs text-soft leading-relaxed whitespace-pre-wrap line-clamp-6">
            {profile.about}
          </p>
        </div>
      )}

      {/* Quick actions */}
      <div className="space-y-1">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
          Actions
        </h4>
        <ActionButton icon={<Phone size={14} />} label="Voice Call" />
        <ActionButton icon={<Video size={14} />} label="Video Call" />
        <ActionButton
          icon={<VolumeX size={14} />}
          label={isMuted ? "Unmute" : "Mute"}
          active={isMuted}
        />
        <ActionButton
          icon={<Ban size={14} />}
          label="Block"
          variant="danger"
        />
      </div>

      {/* Pubkey */}
      <div>
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          Public Key
        </h4>
        <p className="text-[10px] text-muted font-mono break-all select-all">
          {activePubkey}
        </p>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  active,
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  variant?: "danger";
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors ${
        variant === "danger"
          ? "text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
          : active
            ? "bg-surface text-heading"
            : "text-soft hover:bg-surface hover:text-heading"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
