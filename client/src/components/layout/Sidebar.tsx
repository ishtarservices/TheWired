import clsx from "clsx";
import { LayoutGrid, Music2 } from "lucide-react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setSidebarMode } from "../../store/slices/uiSlice";
import { SpaceList } from "../../features/spaces/SpaceList";
import { ChannelList } from "../../features/spaces/ChannelList";
import { MusicSidebar } from "../../features/music/MusicSidebar";
import { ProfileCard } from "../../features/identity/ProfileCard";

interface SidebarProps {
  expanded: boolean;
}

export function Sidebar({ expanded }: SidebarProps) {
  const dispatch = useAppDispatch();
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);

  return (
    <div
      className={clsx(
        "flex flex-col border-r border-edge glass transition-all duration-200",
        expanded ? "w-60" : "w-0 overflow-hidden",
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-edge px-4">
        <span className="text-sm font-bold tracking-widest text-silver-gradient uppercase">
          The Wired
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => dispatch(setSidebarMode("spaces"))}
            className={clsx(
              "rounded p-1 transition-colors",
              sidebarMode === "spaces"
                ? "bg-card-hover/50 text-heading"
                : "text-muted hover:text-heading",
            )}
            title="Spaces"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => dispatch(setSidebarMode("music"))}
            className={clsx(
              "rounded p-1 transition-colors",
              sidebarMode === "music"
                ? "bg-card-hover/50 text-heading"
                : "text-muted hover:text-heading",
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
            <div className="border-b border-edge pb-2">
              <div className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
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
      <div className="relative border-t border-edge p-3">
        {isLoggedIn ? (
          <ProfileCard />
        ) : (
          <div className="text-xs text-muted">Not logged in</div>
        )}
      </div>
    </div>
  );
}
