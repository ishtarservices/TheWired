import { useMemo, useState } from "react";
import {
  Phone,
  Video,
  VolumeX,
  Ban,
  UserCheck,
  UserPlus,
  Clock,
  Zap,
  Pin,
  Archive,
  Timer,
  Users,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useZap } from "../wallet/WalletProvider";
import { useCall } from "../calling/useCall";
import {
  setConversationFlag,
  setConversationExpireAfter,
  isConversationFlagged,
  conversationExpireAfter,
} from "@/store/slices/dmSlice";
import { blockPeer, unblockPeer } from "./dmService";
import { getDisplayName } from "./dmUtils";

const DISAPPEAR_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: "Off", seconds: 0 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86_400 },
  { label: "1 week", seconds: 7 * 86_400 },
];

export function DMContactPanel() {
  const dispatch = useAppDispatch();
  const activeId = useAppSelector((s) => s.dm.activeConversation);
  const contact = useAppSelector((s) => s.dm.contacts.find((c) => c.pubkey === activeId));
  const isRoom = !!contact?.isRoom;
  const { profile } = useProfile(isRoom ? null : activeId);
  const { openZap } = useZap();
  const { startCall, isInCall } = useCall();
  const friendRequests = useAppSelector((s) => s.friendRequests.requests);
  const muteList = useAppSelector((s) => s.identity.muteList);
  const flags = useAppSelector((s) => s.dm.flags);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  const friendStatus = useMemo(() => {
    if (!activeId || isRoom) return null;
    const req = friendRequests.find((r) => r.pubkey === activeId && r.status === "accepted");
    if (req) return "friend" as const;
    const pending = friendRequests.find((r) => r.pubkey === activeId && r.status === "pending");
    if (pending) return "pending" as const;
    return null;
  }, [activeId, friendRequests, isRoom]);

  const isBlocked = useMemo(
    () => !!activeId && muteList.some((m) => m.type === "pubkey" && m.value === activeId),
    [muteList, activeId],
  );

  if (!activeId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-soft">Select a conversation</p>
      </div>
    );
  }

  const isMuted = isConversationFlagged(flags, "muted", activeId);
  const isPinned = isConversationFlagged(flags, "pinned", activeId);
  const isArchived = isConversationFlagged(flags, "archived", activeId);
  const expireAfter = conversationExpireAfter(flags, activeId);

  const displayName = isRoom
    ? contact?.subject || `Room · ${contact?.participants?.length ?? 0} people`
    : getDisplayName(profile, activeId);

  const toggleFlag = (field: "pinned" | "archived" | "muted", on: boolean) =>
    dispatch(setConversationFlag({ field, conversationId: activeId, on }));

  const handleBlock = async () => {
    if (isBlocked) {
      setBusy(true);
      try {
        await unblockPeer(activeId);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!confirmBlock) {
      setConfirmBlock(true);
      return;
    }
    setBusy(true);
    try {
      await blockPeer(activeId);
      setConfirmBlock(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 p-4">
      {/* Profile card */}
      <div className="flex flex-col items-center text-center">
        {isRoom ? (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Users size={24} />
          </div>
        ) : (
          <Avatar src={profile?.picture} size="lg" />
        )}
        <h3 className="mt-3 text-sm font-semibold text-heading truncate max-w-full">{displayName}</h3>
        {!isRoom && profile?.nip05 && (
          <p className="text-[11px] text-primary truncate max-w-full">{profile.nip05}</p>
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
        {!isRoom && !friendStatus && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">
            <UserPlus size={10} />
            Not friends
          </span>
        )}
      </div>

      {/* Room participants */}
      {isRoom && contact?.participants && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
            Participants
          </h4>
          <ul className="space-y-1">
            {contact.participants.map((pk) => (
              <ParticipantRow key={pk} pubkey={pk} />
            ))}
          </ul>
        </div>
      )}

      {/* About */}
      {!isRoom && profile?.about && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">About</h4>
          <p className="text-xs text-soft leading-relaxed whitespace-pre-wrap line-clamp-6">{profile.about}</p>
        </div>
      )}

      {/* Quick actions */}
      <div className="space-y-1">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">Actions</h4>
        {!isRoom && (
          <>
            <ActionButton
              icon={<Zap size={14} />}
              label="Send Zap"
              variant="zap"
              onClick={() => openZap({ recipientPubkey: activeId, displayName })}
            />
            <ActionButton
              icon={<Phone size={14} />}
              label="Voice Call"
              disabled={isInCall}
              onClick={() => startCall(activeId, "audio")}
            />
            <ActionButton
              icon={<Video size={14} />}
              label="Video Call"
              disabled={isInCall}
              onClick={() => startCall(activeId, "video")}
            />
          </>
        )}
        <ActionButton
          icon={<Pin size={14} />}
          label={isPinned ? "Unpin" : "Pin"}
          active={isPinned}
          onClick={() => toggleFlag("pinned", !isPinned)}
        />
        <ActionButton
          icon={<Archive size={14} />}
          label={isArchived ? "Unarchive" : "Archive"}
          active={isArchived}
          onClick={() => toggleFlag("archived", !isArchived)}
        />
        <ActionButton
          icon={<VolumeX size={14} />}
          label={isMuted ? "Unmute" : "Mute"}
          active={isMuted}
          onClick={() => toggleFlag("muted", !isMuted)}
        />
        {!isRoom && (
          <ActionButton
            icon={<Ban size={14} />}
            label={isBlocked ? "Unblock" : confirmBlock ? "Confirm block" : "Block"}
            variant="danger"
            disabled={busy}
            onClick={() => void handleBlock()}
          />
        )}
        {confirmBlock && !isBlocked && (
          <p className="px-3 text-[11px] text-muted">
            Blocking adds them to your public mute list and hides their messages here.{" "}
            <button type="button" className="text-primary" onClick={() => setConfirmBlock(false)}>
              Cancel
            </button>
          </p>
        )}
      </div>

      {/* Disappearing messages */}
      <div>
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1">
          <Timer size={11} /> Disappearing messages
        </h4>
        <div className="flex flex-wrap gap-1">
          {DISAPPEAR_OPTIONS.map((o) => (
            <button
              key={o.seconds}
              type="button"
              onClick={() => dispatch(setConversationExpireAfter({ conversationId: activeId, seconds: o.seconds }))}
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                expireAfter === o.seconds ? "bg-primary/20 text-primary" : "bg-surface text-soft hover:text-heading"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-faint">New messages expire on relays and are deleted here after the timer.</p>
      </div>

      {/* Pubkey / room id */}
      <div>
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">
          {isRoom ? "Room ID" : "Public Key"}
        </h4>
        <p className="text-[10px] text-muted font-mono break-all select-all">{activeId}</p>
      </div>
    </div>
  );
}

function ParticipantRow({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  return (
    <li className="flex items-center gap-2 text-xs text-soft">
      <Avatar src={profile?.picture} size="xs" />
      <span className="truncate">{getDisplayName(profile, pubkey)}</span>
    </li>
  );
}

function ActionButton({
  icon,
  label,
  active,
  variant,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  variant?: "danger" | "zap";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors disabled:opacity-50 ${
        variant === "danger"
          ? "text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
          : variant === "zap"
            ? "text-yellow-400/80 hover:bg-yellow-400/10 hover:text-yellow-400"
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
