import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Outlet, useParams, useNavigate } from "react-router-dom";
import { Layout } from "./Layout";
import { useAppSelector } from "../store/hooks";
import { LoginScreen } from "../features/identity/LoginScreen";
import { SpaceView } from "../features/spaces/SpaceView";
import { ChannelPanel } from "../features/spaces/ChannelPanel";
import { MusicRouter } from "../features/music/MusicRouter";
import { MusicLinkResolver } from "../features/music/MusicLinkResolver";
import { RelayStatusPanel } from "../features/relay/RelayStatusPanel";
import { ProfilePage } from "../features/profile/ProfilePage";
import { NoteThreadPage } from "../features/profile/NoteThreadPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { DMView } from "../features/dm/DMView";
import { DiscoverPage } from "../features/discover/DiscoverPage";
import { FriendsFeedPanel } from "../features/friends/FriendsFeedPanel";
import { JoinSpaceModal } from "../features/spaces/JoinSpaceModal";
import { FRIENDS_FEED_ID } from "../features/friends/friendsFeedConstants";
import { ThemeProvider } from "../contexts/ThemeContext";
import { tryRestoreSession } from "../lib/nostr/loginFlow";
import { ProfileWizard } from "../features/onboarding/ProfileWizard";
import { AppTour } from "../features/onboarding/AppTour";
import { UpdateOverlay } from "../components/UpdateOverlay";
import { getAutoUpdatesEnabled } from "../features/settings/AppSettingsTab";
import { useAppUpdater } from "../hooks/useAppUpdater";

/** Restores session + guards all routes behind login */
function AuthGate() {
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  const switchingAccount = useAppSelector((s) => s.identity.switchingAccount);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    tryRestoreSession().finally(() => setRestoring(false));
  }, []);

  if (restoring || switchingAccount) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background">
        <img
          src="/logo.png"
          alt="The Wired"
          width={64}
          height={64}
          className="rounded-2xl animate-pulse"
        />
        <p className="mt-5 text-sm font-medium text-muted tracking-wide">
          {switchingAccount ? "Switching account..." : "Loading..."}
        </p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return (
    <>
      <Outlet />
      <OnboardingOverlays />
    </>
  );
}

/** Renders profile wizard and app tour overlays when active */
function OnboardingOverlays() {
  const showProfileWizard = useAppSelector((s) => s.onboarding.showProfileWizard);
  const showAppTour = useAppSelector((s) => s.onboarding.showAppTour);

  return (
    <>
      {showProfileWizard && <ProfileWizard />}
      {showAppTour && <AppTour />}
    </>
  );
}

function MainContent() {
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const isMusic = sidebarMode === "music";
  const isFriendsFeed = activeSpaceId === FRIENDS_FEED_ID;

  return (
    <>
      {/* Music view — kept alive so audio playback doesn't restart on sidebar switch */}
      <div className={isMusic ? "flex flex-1 flex-col overflow-hidden" : "hidden"}>
        <MusicRouter />
      </div>

      {/* Spaces view */}
      <div className={isMusic ? "hidden" : "flex flex-1 flex-col overflow-hidden"}>
        {isFriendsFeed ? (
          <FriendsFeedPanel />
        ) : !activeChannelId ? (
          <SpaceView>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-grid">
              <div className="pointer-events-none absolute inset-0 bg-ambient opacity-60" />
              <div className="relative z-10 text-center">
                <h2 className="text-2xl font-bold text-silver-gradient tracking-wide">
                  Welcome to The Wired
                </h2>
                <p className="mt-2 text-sm text-soft">
                  Select a space from the sidebar to get started
                </p>
              </div>
            </div>
          </SpaceView>
        ) : (
          <SpaceView>
            <ChannelPanel />
          </SpaceView>
        )}
      </div>
    </>
  );
}

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const shouldAutoUpdate = isTauri && getAutoUpdatesEnabled();

/** Silently checks for updates on startup; shows overlay only when an update is found */
function AutoUpdateGate({ children }: { children: React.ReactNode }) {
  const { status, version, progress, error } = useAppUpdater(true, true);
  const [dismissed, setDismissed] = useState(false);

  const showOverlay =
    !dismissed &&
    (status === "available" ||
      status === "downloading" ||
      status === "ready");

  if (showOverlay) {
    return (
      <UpdateOverlay
        status={status}
        version={version}
        progress={progress}
        error={error}
        onSkip={() => setDismissed(true)}
      />
    );
  }

  // Error — don't block the app, just let it through
  return <>{children}</>;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        {shouldAutoUpdate ? (
          <AutoUpdateGate>
            <AppRoutes />
          </AutoUpdateGate>
        ) : (
          <AppRoutes />
        )}
      </BrowserRouter>
    </ThemeProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<Layout />}>
          <Route index element={<MainContent />} />
          <Route path="relays" element={<RelayStatusPanel />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="discover" element={<DiscoverPage />} />
          <Route path="dm" element={<DMView />} />
          <Route path="dm/:pubkey" element={<DMView />} />
          <Route path="music/album/:pubkey/:slug" element={<MusicLinkResolver type="album" />} />
          <Route path="music/track/:pubkey/:slug" element={<MusicLinkResolver type="track" />} />
          <Route
            path="note/:noteId"
            element={<NoteRouteWrapper />}
          />
          <Route
            path="profile/:pubkey"
            element={<ProfileRouteWrapper />}
          />
          <Route
            path="invite/:code"
            element={<InviteRouteWrapper />}
          />
        </Route>
      </Route>
    </Routes>
  );
}

function NoteRouteWrapper() {
  const { noteId } = useParams<{ noteId: string }>();
  if (!noteId) return null;
  return <NoteThreadPage noteId={noteId} />;
}

function ProfileRouteWrapper() {
  const { pubkey } = useParams<{ pubkey: string }>();
  if (!pubkey) return null;
  return <ProfilePage pubkey={pubkey} />;
}

function InviteRouteWrapper() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  if (!code) return null;
  return (
    <>
      <MainContent />
      <JoinSpaceModal
        open
        onClose={() => navigate("/")}
        initialCode={code}
      />
    </>
  );
}
