import { useState } from "react";
import { Sidebar } from "../components/layout/Sidebar";
import { CenterPanel } from "../components/layout/CenterPanel";
import { RightPanel } from "../components/layout/RightPanel";
import { TopBar } from "../components/layout/TopBar";
import { ThemeBackground } from "../components/layout/ThemeBackground";
import { FloatingPlaybackBar } from "../features/music/playbackBar/FloatingPlaybackBar";
import { UserPopoverProvider } from "../features/profile/UserPopoverContext";
import { NotificationToastStack } from "../features/notifications/NotificationToast";
import { WalletProvider } from "../features/wallet/WalletProvider";
import { AIProvider } from "../features/ai/AIProvider";
import { CallController } from "../features/calling/CallController";
import { IncomingCallBanner } from "../features/calling/IncomingCallBanner";
import { useAppSelector } from "../store/hooks";
import { useExternalLinkHandler } from "../hooks/useExternalLinkHandler";
import { useCallShortcuts } from "../hooks/useCallShortcuts";
import { ScreenSharePill } from "../features/voice/ScreenSharePill";

export function Layout() {
  useExternalLinkHandler();
  useCallShortcuts();
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const hasTrack = useAppSelector((s) => !!s.music?.player.currentTrackId);
  const hasActiveCall = useAppSelector((s) => !!s.call.activeCall);
  const hasIncomingCall = useAppSelector((s) => !!s.call.incomingCall);

  return (
    <WalletProvider>
      <UserPopoverProvider>
      <AIProvider />
      <ThemeBackground />
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopBar
          sidebarExpanded={sidebarExpanded}
          onToggleSidebar={() => setSidebarExpanded((v) => !v)}
        />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar expanded={sidebarExpanded} />
          <CenterPanel />
          <RightPanel />
        </div>
        {hasTrack && <FloatingPlaybackBar />}
        {hasActiveCall && <CallController />}
        {hasIncomingCall && <IncomingCallBanner />}
        <ScreenSharePill />
        <NotificationToastStack />
      </div>
      </UserPopoverProvider>
    </WalletProvider>
  );
}
