import { useCallback, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { LayoutGrid, Music2, MessageCircle, ChevronRight } from "lucide-react";
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

  // Collapsible sections — persisted to localStorage (per-account)
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const spacesCollapseKey = pubkey ? `${pubkey}:sidebar_spaces_collapsed` : "sidebar_spaces_collapsed";

  const [spacesCollapsed, setSpacesCollapsed] = useState(() => {
    try { return localStorage.getItem(spacesCollapseKey) === "true"; }
    catch { return false; }
  });

  const toggleSpaces = useCallback(() => {
    setSpacesCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(spacesCollapseKey, String(next));
      return next;
    });
  }, [spacesCollapseKey]);

  // Aggregated space unreads for collapsed badge
  const spaceUnread = useAppSelector((s) => s.notifications.spaceUnread);
  const spaceMentions = useAppSelector((s) => s.notifications.spaceMentions);
  const collapsedSpaceBadge = useMemo(() => {
    if (!spacesCollapsed) return null;
    let unread = 0, mentions = 0;
    for (const v of Object.values(spaceUnread)) unread += v;
    for (const v of Object.values(spaceMentions)) mentions += v;
    if (unread === 0 && mentions === 0) return null;
    return { unread, mentions };
  }, [spacesCollapsed, spaceUnread, spaceMentions]);

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
            data-tour="sidebar-spaces"
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
            data-tour="sidebar-music"
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
            data-tour="sidebar-messages"
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

        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sidebarMode === "spaces" && (
          <>
            {/* Spaces — collapsible */}
            <div className={cn("border-b border-border", !spacesCollapsed && "pb-2")}>
              <button
                onClick={toggleSpaces}
                className="flex w-full items-center gap-1 px-5 pt-4 pb-2 group"
              >
                <ChevronRight
                  size={10}
                  className={cn(
                    "text-muted transition-transform duration-150",
                    !spacesCollapsed && "rotate-90",
                  )}
                />
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted group-hover:text-heading transition-colors">
                  Spaces
                </span>
                {collapsedSpaceBadge && (
                  <span
                    className={cn(
                      "ml-auto flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                      collapsedSpaceBadge.mentions > 0 ? "bg-primary" : "bg-surface-hover",
                    )}
                  >
                    {collapsedSpaceBadge.mentions > 0 ? collapsedSpaceBadge.mentions : collapsedSpaceBadge.unread}
                  </span>
                )}
              </button>
              {!spacesCollapsed && <SpaceList />}
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
