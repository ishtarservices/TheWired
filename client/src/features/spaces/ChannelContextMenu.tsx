import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, BellOff, Volume2, AtSign, VolumeX, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "../../store/hooks";
import {
  setChannelNotifMode,
  clearChannelUnread,
  type ChannelNotifMode,
} from "../../store/slices/notificationSlice";
import { useChannelNotifMode, useChannelUnread } from "../notifications/useNotifications";

const NOTIF_MODES: { mode: ChannelNotifMode; label: string; icon: typeof Bell; description: string }[] = [
  { mode: "default", label: "Default", icon: Bell, description: "Use space settings" },
  { mode: "all", label: "All Messages", icon: Volume2, description: "Notified for every message" },
  { mode: "mentions", label: "Mentions Only", icon: AtSign, description: "Only @mentions" },
  { mode: "nothing", label: "Nothing", icon: VolumeX, description: "No notifications" },
  { mode: "muted", label: "Mute Channel", icon: BellOff, description: "Silence everything" },
];

interface ChannelContextMenuProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  position: { x: number; y: number };
}

export function ChannelContextMenu({
  open,
  onClose,
  channelId,
  position,
}: ChannelContextMenuProps) {
  const dispatch = useAppDispatch();
  const currentMode = useChannelNotifMode(channelId);
  const unread = useChannelUnread(channelId);
  const [showModes, setShowModes] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowModes(false);
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setShowModes(false);
  }, [open]);

  if (!open) return null;

  function handleSetMode(mode: ChannelNotifMode) {
    dispatch(setChannelNotifMode({ channelId, mode }));
    setShowModes(false);
    onClose();
  }

  function handleMarkRead() {
    dispatch(clearChannelUnread(channelId));
    onClose();
  }

  const menu = (
    <div
      ref={ref}
      className="fixed z-50 w-max min-w-[180px] rounded-xl card-glass py-1.5 shadow-xl animate-fade-in-up"
      style={{ left: position.x, top: position.y }}
    >
      {showModes ? (
        <div className="py-1">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Notification Mode
          </div>
          {NOTIF_MODES.map((item) => (
            <button
              key={item.mode}
              onClick={() => handleSetMode(item.mode)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2 text-sm transition-colors",
                "text-body hover:bg-surface-hover hover:text-heading",
              )}
            >
              <item.icon size={14} />
              <div className="flex-1 text-left">
                <div>{item.label}</div>
                <div className="text-[10px] text-muted">{item.description}</div>
              </div>
              {currentMode === item.mode && (
                <Check size={14} className="text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      ) : (
        <>
          {unread > 0 && (
            <button
              onClick={handleMarkRead}
              className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
            >
              <Check size={14} />
              Mark as Read
            </button>
          )}

          <button
            onClick={() => setShowModes(true)}
            className="flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm text-body hover:bg-surface-hover hover:text-heading transition-colors"
          >
            <Bell size={14} />
            Notification Settings
            <span className="ml-auto text-[10px] text-muted">
              {currentMode === "default" ? "Default" : NOTIF_MODES.find((m) => m.mode === currentMode)?.label}
            </span>
          </button>
        </>
      )}
    </div>
  );

  return createPortal(menu, document.body);
}
