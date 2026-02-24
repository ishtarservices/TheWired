import { useNavigate, useLocation } from "react-router-dom";
import clsx from "clsx";
import { MessageSquare, FileText, Image, BookOpen, Music } from "lucide-react";
import { useSpace } from "./useSpace";
import type { SpaceChannelType } from "../../types/space";

interface ChannelDef {
  type: SpaceChannelType;
  label: string;
  icon: typeof MessageSquare;
  requiresReadWrite: boolean;
}

const channelDefs: ChannelDef[] = [
  { type: "chat", label: "#chat", icon: MessageSquare, requiresReadWrite: true },
  { type: "notes", label: "#notes", icon: FileText, requiresReadWrite: false },
  { type: "media", label: "#media", icon: Image, requiresReadWrite: false },
  { type: "articles", label: "#articles", icon: BookOpen, requiresReadWrite: false },
  { type: "music", label: "#music", icon: Music, requiresReadWrite: false },
];

export function ChannelList() {
  const { activeSpace, activeChannelId, selectChannel } = useSpace();
  const navigate = useNavigate();
  const location = useLocation();

  if (!activeSpace) return null;

  const handleSelectChannel = (channelType: string) => {
    selectChannel(channelType);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const visibleChannels = channelDefs.filter(
    (ch) => !ch.requiresReadWrite || activeSpace.mode === "read-write",
  );

  return (
    <div className="space-y-0.5 p-2">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Channels
      </div>
      {visibleChannels.map((ch) => {
        const channelId = `${activeSpace.id}:${ch.type}`;
        const isActive = channelId === activeChannelId;

        return (
          <button
            key={ch.type}
            onClick={() => handleSelectChannel(ch.type)}
            className={clsx(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
              isActive
                ? "bg-card-hover/50 text-heading"
                : "text-soft hover:bg-card/30 hover:text-heading",
            )}
          >
            <ch.icon size={16} />
            <span>{ch.label}</span>
          </button>
        );
      })}
    </div>
  );
}
