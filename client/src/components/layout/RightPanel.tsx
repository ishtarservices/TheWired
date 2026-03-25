import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Users, Info, ListMusic, Music2, User, Link2 } from "lucide-react";
import { MemberList } from "../../features/spaces/MemberList";
import { SpaceInfoPanel } from "../../features/spaces/SpaceInfoPanel";
import { QueueContent } from "../../features/music/QueueContent";
import { NowPlayingDetail } from "../../features/music/NowPlayingDetail";
import { DMContactPanel } from "../../features/dm/DMContactPanel";
import { ProfileSidePanel } from "../../features/profile/ProfileSidePanel";
import { useResizeHandle } from "./useResizeHandle";
import { useRightPanelContext } from "./useRightPanelContext";
import { RightPanelTabBar } from "./RightPanelTabBar";
import type { PanelContext } from "@/store/slices/uiSlice";

// Lazy-mount tracker: only render a context's content after it's been visited
function useLazyContexts(context: PanelContext, isOpen: boolean) {
  const [mounted, setMounted] = useState<Set<PanelContext>>(new Set());

  useEffect(() => {
    if (isOpen && context !== "none" && !mounted.has(context)) {
      setMounted((prev) => new Set(prev).add(context));
    }
  }, [context, isOpen, mounted]);

  return mounted;
}

const CONTEXT_TITLES: Record<PanelContext, string> = {
  space: "Space",
  music: "Music",
  dm: "Contact",
  profile: "Profile",
  none: "",
};

const CONTEXT_ICONS: Record<PanelContext, React.ReactNode> = {
  space: <Users size={16} />,
  music: <Music2 size={16} />,
  dm: <User size={16} />,
  profile: <Link2 size={16} />,
  none: null,
};

// Tab-specific icons shown in the header based on active tab
const TAB_ICONS: Record<string, React.ReactNode> = {
  members: <Users size={16} />,
  info: <Info size={16} />,
  queue: <ListMusic size={16} />,
  details: <Music2 size={16} />,
  profile: <User size={16} />,
};

export function RightPanel() {
  const { context, isOpen, activeTab, tabs, setTab } =
    useRightPanelContext();
  const { width, isDragging, onMouseDown, onDoubleClick } = useResizeHandle({
    side: "left",
  });
  const mounted = useLazyContexts(context, isOpen);

  const visible = isOpen && context !== "none";

  // Determine header icon: use tab-specific icon if available, else context icon
  const headerIcon = TAB_ICONS[activeTab] ?? CONTEXT_ICONS[context];
  const headerTitle =
    tabs.find((t) => t.id === activeTab)?.label ?? CONTEXT_TITLES[context];

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col glass relative",
        !visible && "w-0 overflow-hidden",
        !isDragging && "transition-[width] duration-200",
      )}
      style={visible ? { width } : undefined}
    >
      {/* Resize handle — left edge */}
      {visible && (
        <div
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          className="group absolute left-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize"
        >
          <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-primary-soft/10 via-border to-primary/20" />
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-0 transition-all duration-150",
              isDragging
                ? "w-[2px] bg-primary/40"
                : "group-hover:w-[2px] group-hover:bg-primary/20",
            )}
          />
        </div>
      )}

      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <span className="text-soft">{headerIcon}</span>
          <span className="text-sm font-semibold text-body">{headerTitle}</span>
        </div>
        <RightPanelTabBar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setTab}
        />
      </div>

      {/* Tab content — keep-alive via display:none */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Space context ── */}
        {mounted.has("space") && (
          <>
            <div
              className={
                context === "space" && activeTab === "members" ? "" : "hidden"
              }
            >
              <MemberList />
            </div>
            <div
              className={
                context === "space" && activeTab === "info" ? "" : "hidden"
              }
            >
              <SpaceInfoPanel />
            </div>
          </>
        )}

        {/* ── Music context ── */}
        {mounted.has("music") && (
          <>
            <div
              className={
                context === "music" && activeTab === "queue" ? "" : "hidden"
              }
            >
              <QueueContent />
            </div>
            <div
              className={
                context === "music" && activeTab === "details" ? "" : "hidden"
              }
            >
              <NowPlayingDetail />
            </div>
          </>
        )}

        {/* ── DM context ── */}
        {mounted.has("dm") && (
          <div className={context === "dm" ? "" : "hidden"}>
            <DMContactPanel />
          </div>
        )}

        {/* ── Profile context ── */}
        {mounted.has("profile") && (
          <div className={context === "profile" ? "" : "hidden"}>
            <ProfileSidePanel />
          </div>
        )}
      </div>
    </div>
  );
}

