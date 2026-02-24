import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Outlet, useParams } from "react-router-dom";
import { Layout } from "./Layout";
import { useAppSelector } from "../store/hooks";
import { LoginScreen } from "../features/identity/LoginScreen";
import { SpaceView } from "../features/spaces/SpaceView";
import { ChannelPanel } from "../features/spaces/ChannelPanel";
import { MusicRouter } from "../features/music/MusicRouter";
import { MusicLinkResolver } from "../features/music/MusicLinkResolver";
import { RelayStatusPanel } from "../features/relay/RelayStatusPanel";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { Spinner } from "../components/ui/Spinner";
import { ThemeProvider } from "../contexts/ThemeContext";
import { tryRestoreSession } from "../lib/nostr/loginFlow";

/** Restores session + guards all routes behind login */
function AuthGate() {
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    tryRestoreSession().finally(() => setRestoring(false));
  }, []);

  if (restoring) {
    return (
      <div className="flex h-screen items-center justify-center bg-backdrop">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginScreen />;
  }

  return <Outlet />;
}

function MainContent() {
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const isMusic = sidebarMode === "music";

  return (
    <>
      {/* Music view — kept alive so audio playback doesn't restart on sidebar switch */}
      <div className={isMusic ? "flex flex-1 flex-col overflow-hidden" : "hidden"}>
        <MusicRouter />
      </div>

      {/* Spaces view */}
      <div className={isMusic ? "hidden" : "flex flex-1 flex-col overflow-hidden"}>
        {!activeChannelId ? (
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

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AuthGate />}>
            <Route element={<Layout />}>
              <Route index element={<MainContent />} />
              <Route path="relays" element={<RelayStatusPanel />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="music/album/:pubkey/:slug" element={<MusicLinkResolver type="album" />} />
              <Route path="music/track/:pubkey/:slug" element={<MusicLinkResolver type="track" />} />
              <Route
                path="profile/:pubkey"
                element={<ProfileRouteWrapper />}
              />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

function ProfileRouteWrapper() {
  const { pubkey } = useParams<{ pubkey: string }>();
  if (!pubkey) return null;
  return <ProfilePage pubkey={pubkey} />;
}
