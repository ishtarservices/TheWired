import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { MessageSquare, FileText, Image, BookOpen, Music, Plus, BellOff } from "lucide-react";
import { useSpace } from "./useSpace";
import { useSpaceChannels } from "./useSpaceChannels";
import { useAppSelector } from "../../store/hooks";
import { usePermissions } from "./usePermissions";
import { useChannelUnread, useChannelMentions, useChannelMuted } from "../notifications/useNotifications";
import { CreateChannelModal } from "./CreateChannelModal";
import { ChannelContextMenu } from "./ChannelContextMenu";
import type { SpaceChannelType } from "../../types/space";

const CHANNEL_ICONS: Record<SpaceChannelType, typeof MessageSquare> = {
  chat: MessageSquare,
  notes: FileText,
  media: Image,
  articles: BookOpen,
  music: Music,
};

export function ChannelList() {
  const { activeSpace, activeChannelId, selectChannel } = useSpace();
  const { channels } = useSpaceChannels(activeSpace?.id ?? null);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const { can } = usePermissions(activeSpace?.id ?? null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);

  const handleChannelContextMenu = useCallback((e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    setCtxMenu({ channelId, x: e.clientX, y: e.clientY });
  }, []);

  // When channels load and the current activeChannelId is null or doesn't match
  // any loaded channel (e.g. stale "chat" fallback), auto-select the best default
  useEffect(() => {
    if (!activeSpace || channels.length === 0) return;

    const channelIdPart = activeChannelId?.split(":").slice(1).join(":") ?? "";
    const isValid = channels.some((c) => c.id === channelIdPart);

    if (!isValid) {
      // Filter: hide chat for read-only spaces
      const visible =
        activeSpace.mode === "read"
          ? channels.filter((c) => c.type !== "chat")
          : channels;
      const sorted = [...(visible.length > 0 ? visible : channels)].sort(
        (a, b) => a.position - b.position,
      );
      const best = sorted.find((c) => c.isDefault) ?? sorted[0];
      if (best) {
        selectChannel(best.id);
      }
    }
  }, [activeSpace, activeChannelId, channels, selectChannel]);

  if (!activeSpace) return null;

  // Use backend permissions if available, fall back to local admin check
  const isAdmin = can("MANAGE_CHANNELS") || (!!currentPubkey && activeSpace.adminPubkeys.includes(currentPubkey));

  const handleSelectChannel = (channelId: string) => {
    selectChannel(channelId);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const sortedChannels = [...channels].sort((a, b) => a.position - b.position);

  // Filter channels: read-write spaces show all, read-only hides chat
  const visibleChannels = sortedChannels.filter(
    (ch) => ch.type !== "chat" || activeSpace.mode === "read-write",
  );

  return (
    <div className="p-3 space-y-1">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
          Channels
        </span>
        {isAdmin && (
          <button
            onClick={() => setCreateModalOpen(true)}
            className="rounded p-0.5 text-muted hover:bg-card/50 hover:text-heading transition-colors"
            title="Create channel"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {visibleChannels.map((ch) => {
        const channelActiveId = `${activeSpace.id}:${ch.id}`;
        const isActive = channelActiveId === activeChannelId;
        const Icon = CHANNEL_ICONS[ch.type] ?? MessageSquare;

        return (
          <ChannelButton
            key={ch.id}
            channelId={channelActiveId}
            label={ch.label}
            isActive={isActive}
            slowModeSeconds={ch.slowModeSeconds}
            Icon={Icon}
            onClick={() => handleSelectChannel(ch.id)}
            onContextMenu={(e) => handleChannelContextMenu(e, channelActiveId)}
          />
        );
      })}

      <CreateChannelModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        spaceId={activeSpace.id}
        existingChannels={channels}
      />

      {ctxMenu && (
        <ChannelContextMenu
          open
          onClose={() => setCtxMenu(null)}
          channelId={ctxMenu.channelId}
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
        />
      )}
    </div>
  );
}

/** Channel button with unread/mention badges (separate component for hook rules) */
function ChannelButton({
  channelId,
  label,
  isActive,
  slowModeSeconds,
  Icon,
  onClick,
  onContextMenu,
}: {
  channelId: string;
  label: string;
  isActive: boolean;
  slowModeSeconds: number;
  Icon: typeof MessageSquare;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const unread = useChannelUnread(channelId);
  const mentions = useChannelMentions(channelId);
  const isMuted = useChannelMuted(channelId);
  const hasUnread = unread > 0 || mentions > 0;

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
        isActive
          ? "bg-surface-hover text-heading"
          : hasUnread && !isMuted
            ? "text-heading font-semibold hover:bg-surface-hover"
            : "text-soft hover:bg-surface-hover hover:text-heading",
      )}
    >
      <Icon size={16} />
      <span className="truncate">{label}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {isMuted && (
          <BellOff size={11} className="shrink-0 text-muted" />
        )}
        {mentions > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-pulse px-1 text-[10px] font-bold text-white">
            @{mentions}
          </span>
        )}
        {unread > 0 && mentions === 0 && !isMuted && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-hover px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
        {unread > 0 && mentions === 0 && isMuted && (
          <span className="h-2 w-2 rounded-full bg-surface-hover shrink-0" />
        )}
        {slowModeSeconds > 0 && (
          <span className="text-[10px] text-muted" title={`Slow mode: ${slowModeSeconds}s`}>
            🐢
          </span>
        )}
      </span>
    </button>
  );
}
