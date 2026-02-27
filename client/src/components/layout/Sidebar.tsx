import { cn } from "@/lib/utils";
import { LayoutGrid, Music2 } from "lucide-react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setSidebarMode } from "../../store/slices/uiSlice";
import { SpaceList } from "../../features/spaces/SpaceList";
import { ChannelList } from "../../features/spaces/ChannelList";
import { MusicSidebar } from "../../features/music/MusicSidebar";
import { ProfileCard } from "../../features/identity/ProfileCard";
import { useResizeHandle } from "./useResizeHandle";

interface SidebarProps {
  expanded: boolean;
}

export function Sidebar({ expanded }: SidebarProps) {
  const dispatch = useAppDispatch();
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const { width, isDragging, onMouseDown, onDoubleClick } = useResizeHandle({
    side: "right",
  });

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col glass relative",
        !expanded && "w-0 overflow-hidden",
        !isDragging && "transition-[width] duration-200",
      )}
      style={expanded ? { width } : undefined}
    >
      {/* Resize handle — right edge */}
      {expanded && (
        <div
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          className="group absolute right-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize"
        >
          {/* Decorative gradient edge */}
          <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-pulse/20 via-edge to-neon/10" />
          {/* Interactive highlight */}
          <div
            className={cn(
              "absolute inset-y-0 right-0 w-0 transition-all duration-150",
              isDragging
                ? "w-[2px] bg-pulse/40"
                : "group-hover:w-[2px] group-hover:bg-pulse/20",
            )}
          />
        </div>
      )}

      <div className="flex h-14 items-center justify-between border-b border-white/[0.04] px-5">
        <span className="text-sm font-bold tracking-[0.2em] text-gradient-accent uppercase">
          The Wired
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => dispatch(setSidebarMode("spaces"))}
            className={cn(
              "rounded-lg p-1.5 transition-colors",
              sidebarMode === "spaces"
                ? "bg-pulse/15 text-pulse"
                : "text-muted hover:text-heading hover:bg-white/[0.04]",
            )}
            title="Spaces"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => dispatch(setSidebarMode("music"))}
            className={cn(
              "rounded-lg p-1.5 transition-colors",
              sidebarMode === "music"
                ? "bg-pulse/15 text-pulse"
                : "text-muted hover:text-heading hover:bg-white/[0.04]",
            )}
            title="Music"
          >
            <Music2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sidebarMode === "spaces" ? (
          <>
            {/* Spaces */}
            <div className="border-b border-white/[0.04] pb-2">
              <div className="px-5 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                Spaces
              </div>
              <SpaceList />
            </div>

            {/* Channels for active space */}
            {activeSpaceId && <ChannelList />}
          </>
        ) : (
          <MusicSidebar />
        )}
      </div>

      {/* User profile */}
      <div className="relative border-t border-white/[0.04] p-4">
        {isLoggedIn ? (
          <ProfileCard />
        ) : (
          <div className="text-xs text-muted">Not logged in</div>
        )}
      </div>
    </div>
  );
}
