import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import clsx from "clsx";
import { MessageSquare, FileText, Image, BookOpen, Music, Plus } from "lucide-react";
import { useSpace } from "./useSpace";
import { useSpaceChannels } from "./useSpaceChannels";
import { useAppSelector } from "../../store/hooks";
import { usePermissions } from "./usePermissions";
import { CreateChannelModal } from "./CreateChannelModal";
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
    <div className="space-y-0.5 p-2">
      <div className="mb-1 flex items-center justify-between px-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
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
          <button
            key={ch.id}
            onClick={() => handleSelectChannel(ch.id)}
            className={clsx(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
              isActive
                ? "bg-card-hover/50 text-heading"
                : "text-soft hover:bg-card/30 hover:text-heading",
            )}
          >
            <Icon size={16} />
            <span>{ch.label}</span>
            {ch.slowModeSeconds > 0 && (
              <span className="ml-auto text-[10px] text-muted" title={`Slow mode: ${ch.slowModeSeconds}s`}>
                🐢
              </span>
            )}
          </button>
        );
      })}

      <CreateChannelModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        spaceId={activeSpace.id}
        existingChannels={channels}
      />
    </div>
  );
}
