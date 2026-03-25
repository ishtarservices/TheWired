import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BellOff, Bell, Clock, Link2, LogOut, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setSpaceMute, removeSpaceMute } from "../../store/slices/notificationSlice";
import { useSpaceMuted } from "../notifications/useNotifications";
import { usePermissions } from "./usePermissions";
import { useSpace } from "./useSpace";
import { InviteGenerateModal } from "./InviteGenerateModal";
import { deleteSpaceApi, leaveSpaceApi } from "../../lib/api/spaces";

const MUTE_DURATIONS = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Permanent", ms: 0 },
];

interface SpaceContextMenuProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  position: { x: number; y: number };
}

export function SpaceContextMenu({
  open,
  onClose,
  spaceId,
  position,
}: SpaceContextMenuProps) {
  const dispatch = useAppDispatch();
  const isMuted = useSpaceMuted(spaceId);
  const { can } = usePermissions(spaceId);
  const { deleteSpace } = useSpace();
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const isCreator = !!currentPubkey && space?.creatorPubkey === currentPubkey;
  const [showDurations, setShowDurations] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowDurations(false);
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  // Reset submenus on close
  useEffect(() => {
    if (!open) {
      setShowDurations(false);
      setConfirmDelete(false);
    }
  }, [open]);

  if (!open && !showInvite) return null;

  function handleUnmute() {
    dispatch(removeSpaceMute(spaceId));
    onClose();
  }

  function handleMute(ms: number) {
    const muteUntil = ms > 0 ? Date.now() + ms : undefined;
    dispatch(setSpaceMute({ spaceId, mute: { muted: true, muteUntil } }));
    setShowDurations(false);
    onClose();
  }

  async function handleLeave() {
    try {
      await leaveSpaceApi(spaceId);
    } catch {
      // Backend unavailable — still clean up locally
    }
    deleteSpace(spaceId);
    onClose();
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteSpaceApi(spaceId);
    } catch {
      // Backend delete failed — still clean up locally
    }
    deleteSpace(spaceId);
    onClose();
  }

  const menu = (
    <div
      ref={ref}
      className="fixed z-50 w-max min-w-[160px] rounded-xl card-glass py-1.5 shadow-xl animate-fade-in-up"
      style={{ left: position.x, top: position.y }}
    >
      {showDurations ? (
        <div className="py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Mute Duration
          </div>
          {MUTE_DURATIONS.map((d) => (
            <button
              key={d.label}
              onClick={() => handleMute(d.ms)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm transition-colors",
                "text-body hover:bg-surface-hover hover:text-heading",
              )}
            >
              <Clock size={14} />
              {d.label}
            </button>
          ))}
        </div>
      ) : confirmDelete ? (
        <div className="py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">
            Permanently delete this space?
          </div>
          <button
            onClick={handleDelete}
            className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
            Yes, delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          {can("CREATE_INVITES") && (
            <button
              onClick={() => { setShowInvite(true); onClose(); }}
              className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
            >
              <Link2 size={14} />
              Create Invite
            </button>
          )}
          {isMuted ? (
            <button
              onClick={handleUnmute}
              className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
            >
              <Bell size={14} />
              Unmute notifications
            </button>
          ) : (
            <button
              onClick={() => setShowDurations(true)}
              className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
            >
              <BellOff size={14} />
              Mute notifications
            </button>
          )}

          {/* Divider */}
          <div className="my-1 border-t border-border" />

          {/* Leave Space */}
          <button
            onClick={handleLeave}
            className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
          >
            <LogOut size={14} />
            Leave Space
          </button>

          {/* Delete Space (creator only) */}
          {isCreator && (
            <button
              onClick={handleDelete}
              className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={14} />
              Delete Space
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      {open && createPortal(menu, document.body)}
      <InviteGenerateModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        spaceId={spaceId}
        spaceName={space?.name ?? "Space"}
      />
    </>
  );
}
