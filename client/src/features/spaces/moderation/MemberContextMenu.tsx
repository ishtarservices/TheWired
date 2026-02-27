import { useState, type RefObject } from "react";
import { User, VolumeX, LogOut, Ban, Clock } from "lucide-react";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "../../../components/ui/PopoverMenu";
import { usePermissions } from "../usePermissions";
import { useModeration } from "./useModeration";
import { useNavigate } from "react-router-dom";

const MUTE_DURATIONS = [
  { label: "5 minutes", seconds: 300 },
  { label: "15 minutes", seconds: 900 },
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86400 },
];

interface MemberContextMenuProps {
  open: boolean;
  onClose: () => void;
  pubkey: string;
  spaceId: string;
  anchorRef?: RefObject<HTMLElement | null>;
}

export function MemberContextMenu({
  open,
  onClose,
  pubkey,
  spaceId,
  anchorRef,
}: MemberContextMenuProps) {
  const navigate = useNavigate();
  const { can } = usePermissions(spaceId);
  const { banMember, muteMember, kickMember } = useModeration(spaceId);
  const [showMuteDurations, setShowMuteDurations] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"kick" | "ban" | null>(null);
  const [banReason, setBanReason] = useState("");

  function handleViewProfile() {
    navigate(`/profile/${pubkey}`);
    onClose();
  }

  async function handleKick() {
    await kickMember(pubkey);
    onClose();
    setConfirmAction(null);
  }

  async function handleBan() {
    await banMember(pubkey, banReason || undefined);
    onClose();
    setConfirmAction(null);
    setBanReason("");
  }

  async function handleMute(seconds: number) {
    await muteMember(pubkey, seconds);
    setShowMuteDurations(false);
    onClose();
  }

  if (confirmAction === "kick") {
    return (
      <PopoverMenu open={open} onClose={onClose} position="below" anchorRef={anchorRef}>
        <div className="p-3 space-y-2">
          <p className="text-sm text-heading">Kick this member?</p>
          <p className="text-xs text-muted">They can rejoin with an invite.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmAction(null)}
              className="flex-1 rounded-lg mx-1 px-3.5 py-2.5 text-xs text-soft hover:bg-white/[0.04]"
            >
              Cancel
            </button>
            <button
              onClick={handleKick}
              className="flex-1 rounded-lg mx-1 px-3.5 py-2.5 text-xs text-red-400 hover:bg-red-500/20"
            >
              Kick
            </button>
          </div>
        </div>
      </PopoverMenu>
    );
  }

  if (confirmAction === "ban") {
    return (
      <PopoverMenu open={open} onClose={onClose} position="below" anchorRef={anchorRef}>
        <div className="p-3 space-y-2">
          <p className="text-sm text-heading">Ban this member?</p>
          <input
            type="text"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="Reason (optional)"
            className="w-full rounded-md rounded-xl bg-white/[0.04] border border-white/[0.04] px-2 py-1 text-xs text-heading placeholder-muted focus:border-neon focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setConfirmAction(null); setBanReason(""); }}
              className="flex-1 rounded-lg mx-1 px-3.5 py-2.5 text-xs text-soft hover:bg-white/[0.04]"
            >
              Cancel
            </button>
            <button
              onClick={handleBan}
              className="flex-1 rounded-lg mx-1 px-3.5 py-2.5 text-xs text-red-400 hover:bg-red-500/20"
            >
              Ban
            </button>
          </div>
        </div>
      </PopoverMenu>
    );
  }

  if (showMuteDurations) {
    return (
      <PopoverMenu open={open} onClose={() => { setShowMuteDurations(false); onClose(); }} position="below" anchorRef={anchorRef}>
        <div className="py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Mute Duration
          </div>
          {MUTE_DURATIONS.map((d) => (
            <PopoverMenuItem
              key={d.seconds}
              icon={<Clock size={14} />}
              label={d.label}
              onClick={() => handleMute(d.seconds)}
            />
          ))}
        </div>
      </PopoverMenu>
    );
  }

  return (
    <PopoverMenu open={open} onClose={onClose} position="below" anchorRef={anchorRef}>
      <PopoverMenuItem
        icon={<User size={14} />}
        label="View Profile"
        onClick={handleViewProfile}
      />
      {can("MUTE_MEMBERS") && (
        <PopoverMenuItem
          icon={<VolumeX size={14} />}
          label="Mute"
          onClick={() => setShowMuteDurations(true)}
        />
      )}
      {can("MANAGE_MEMBERS") && (
        <>
          <PopoverMenuSeparator />
          <PopoverMenuItem
            icon={<LogOut size={14} />}
            label="Kick"
            variant="danger"
            onClick={() => setConfirmAction("kick")}
          />
        </>
      )}
      {can("BAN_MEMBERS") && (
        <PopoverMenuItem
          icon={<Ban size={14} />}
          label="Ban"
          variant="danger"
          onClick={() => setConfirmAction("ban")}
        />
      )}
    </PopoverMenu>
  );
}
