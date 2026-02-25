import { useState } from "react";
import { Sidebar } from "../components/layout/Sidebar";
import { CenterPanel } from "../components/layout/CenterPanel";
import { RightPanel } from "../components/layout/RightPanel";
import { TopBar } from "../components/layout/TopBar";
import { PlaybackBar } from "../features/music/PlaybackBar";
import { QueuePanel } from "../features/music/QueuePanel";
import { useAppSelector, useAppDispatch } from "../store/hooks";
import { toggleMemberList } from "../store/slices/uiSlice";

export function Layout() {
  const dispatch = useAppDispatch();
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const memberListVisible = useAppSelector((s) => s.ui.memberListVisible);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const hasTrack = useAppSelector((s) => !!s.music?.player.currentTrackId);

  const showRightPanel = !!activeSpaceId && memberListVisible;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ambient">
      <TopBar
        sidebarExpanded={sidebarExpanded}
        onToggleSidebar={() => setSidebarExpanded((v) => !v)}
        memberListVisible={memberListVisible}
        onToggleMemberList={() => dispatch(toggleMemberList())}
        hasActiveSpace={!!activeSpaceId}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar expanded={sidebarExpanded} />
        <CenterPanel />
        <RightPanel visible={showRightPanel} />
        <QueuePanel />
      </div>
      {hasTrack && <PlaybackBar />}
    </div>
  );
}
