import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { LayoutGrid, Music2, MessageCircle, Compass } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setSidebarMode } from "../../store/slices/uiSlice";
import { setActiveConversation } from "../../store/slices/dmSlice";
import { SpaceList } from "../../features/spaces/SpaceList";
import { ChannelList } from "../../features/spaces/ChannelList";
import { MusicSidebar } from "../../features/music/MusicSidebar";
import { DMSidebar } from "../../features/dm/DMSidebar";
import { ProfileCard } from "../../features/identity/ProfileCard";
import { useDMUnreadCount } from "../../features/dm/useDMContacts";
import { VoiceStatusBar } from "../../features/voice/VoiceStatusBar";
import { useResizeHandle } from "./useResizeHandle";
import { FRIENDS_FEED_ID } from "../../features/friends/friendsFeedConstants";

interface SidebarProps {
  expanded: boolean;
}

export function Sidebar({ expanded }: SidebarProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const dmUnreadCount = useDMUnreadCount();
  const activeConversation = useAppSelector((s) => s.dm.activeConversation);
  const { width, isDragging, onMouseDown, onDoubleClick } = useResizeHandle({
    side: "right",
  });

  // Show channels for real spaces (not Friends Feed virtual space)
  const showChannels = activeSpaceId && activeSpaceId !== FRIENDS_FEED_ID;

  const handleSelectDMContact = useCallback(
    (pubkey: string) => {
      dispatch(setActiveConversation(pubkey));
      navigate(`/dm/${pubkey}`);
    },
    [dispatch, navigate],
  );

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
          <div className="absolute inset-y-0 right-0 w-px bg-linear-to-b from-primary/20 via-border to-primary-soft/10" />
          {/* Interactive highlight */}
          <div
            className={cn(
              "absolute inset-y-0 right-0 w-0 transition-all duration-150",
              isDragging
                ? "w-[2px] bg-primary/40"
                : "group-hover:w-[2px] group-hover:bg-primary/20",
            )}
          />
        </div>
      )}

      <div className="flex h-14 items-center justify-between border-b border-border px-5">
        <span className="text-sm font-bold tracking-[0.2em] text-gradient-accent uppercase">
          The Wired
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              dispatch(setSidebarMode("spaces"));
              navigate("/");
            }}
            className={cn(
              "rounded-lg p-1.5 transition-colors",
              sidebarMode === "spaces"
                ? "bg-primary/10 text-primary"
                : "text-muted hover:text-heading hover:bg-surface",
            )}
            title="Spaces"
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => {
              dispatch(setSidebarMode("music"));
              navigate("/");
            }}
            className={cn(
              "rounded-lg p-1.5 transition-colors",
              sidebarMode === "music"
                ? "bg-primary/10 text-primary"
                : "text-muted hover:text-heading hover:bg-surface",
            )}
            title="Music"
          >
            <Music2 size={14} />
          </button>
          <button
            onClick={() => {
              dispatch(setSidebarMode("messages"));
              navigate("/dm");
            }}
            className={cn(
              "relative rounded-lg p-1.5 transition-colors",
              sidebarMode === "messages"
                ? "bg-primary/10 text-primary"
                : "text-muted hover:text-heading hover:bg-surface",
            )}
            title="Messages"
          >
            <MessageCircle size={14} />
            {dmUnreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-white">
                {dmUnreadCount}
              </span>
            )}
          </button>

          {/* Separator */}
          <div className="mx-0.5 h-4 w-px bg-border" />

          {/* Discover */}
          <button
            onClick={() => navigate("/discover")}
            className="rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface transition-colors"
            title="Discover"
          >
            <Compass size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sidebarMode === "spaces" && (
          <>
            {/* Spaces */}
            <div className="border-b border-border pb-2">
              <div className="px-5 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                Spaces
              </div>
              <SpaceList />
            </div>

            {/* Channels for active space */}
            {showChannels && <ChannelList />}
          </>
        )}
        {sidebarMode === "music" && <MusicSidebar />}
        {sidebarMode === "messages" && (
          <DMSidebar
            activePartner={activeConversation}
            onSelectContact={handleSelectDMContact}
          />
        )}
      </div>

      {/* Voice status bar */}
      <VoiceStatusBar />

      {/* User profile */}
      <div className="relative border-t border-border p-4">
        {isLoggedIn ? (
          <ProfileCard />
        ) : (
          <div className="text-xs text-muted">Not logged in</div>
        )}
      </div>
    </div>
  );
}
