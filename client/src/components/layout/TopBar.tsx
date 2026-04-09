import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ArrowLeft,
  ArrowRight,
  LayoutGrid,
  Music2,
  MessageCircle,
  Settings,
  Radio,
  User,
  Compass,
  Users,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";
import { SearchInput } from "../../features/music/SearchInput";
import { UserSearchInput } from "../../features/search/UserSearchInput";
import { NotificationBell } from "../../features/notifications/NotificationBell";
import { ThemeQuickPicker } from "./ThemeQuickPicker";
import { useAppSelector } from "../../store/hooks";
import { useNavigationHistory } from "../../hooks/useNavigationHistory";
import { useProfile } from "../../features/profile/useProfile";
import { useRightPanelContext } from "./useRightPanelContext";
import type { MusicView } from "../../types/music";

/** macOS with overlay titlebar needs top padding for traffic lights */
const isTauriMacOS =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window &&
  /Mac/.test(navigator.platform);

interface TopBarProps {
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
}

const musicViewLabels: Record<MusicView, string> = {
  home: "Music",
  explore: "Explore",
  "recently-added": "Recently Added",
  favorites: "Favorites",
  artists: "Artists",
  albums: "Projects",
  songs: "Songs",
  playlists: "Playlists",
  "my-uploads": "My Music",
  search: "Search Results",
  insights: "Insights",
  "project-history": "Project History",
  // "project-proposals": "Proposals", // TODO: re-enable later
  "artist-detail": "Artist",
  "album-detail": "Project",
  "playlist-detail": "Playlist",
  "for-you": "For You",
};

export function TopBar({
  sidebarExpanded,
  onToggleSidebar,
}: TopBarProps) {
  const { canGoBack, canGoForward, goBack, goForward } =
    useNavigationHistory();
  const { context, isOpen, toggle } = useRightPanelContext();

  const location = useLocation();
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const spaces = useAppSelector((s) => s.spaces.list);
  const allChannels = useAppSelector((s) => s.spaces.channels);
  const musicView = useAppSelector((s) => s.music.activeView);
  const musicDetailId = useAppSelector((s) => s.music.activeDetailId);
  const albums = useAppSelector((s) => s.music.albums);
  const playlists = useAppSelector((s) => s.music.playlists);
  const dmPubkey = useAppSelector((s) => s.dm.activeConversation);

  // Profile lookups — hooks are called unconditionally, pass null when not needed
  const profileMatch = location.pathname.match(/^\/profile\/([0-9a-f]+)$/);
  const profilePubkey = profileMatch ? profileMatch[1] : null;
  const artistPubkey =
    musicView === "artist-detail" ? musicDetailId : null;

  const { profile: viewedProfile } = useProfile(profilePubkey);
  const { profile: dmProfile } = useProfile(dmPubkey);
  const { profile: artistProfile } = useProfile(artistPubkey);

  // Compute context-aware location info
  const loc = getLocationInfo();

  function getLocationInfo(): {
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
  } {
    // Route-level overrides
    if (location.pathname === "/settings") {
      return { icon: <Settings size={18} />, title: "Settings" };
    }
    if (location.pathname === "/relays") {
      return { icon: <Radio size={18} />, title: "Relays" };
    }
    if (location.pathname === "/discover") {
      return { icon: <Compass size={18} />, title: "Discover" };
    }
    if (profilePubkey) {
      return {
        icon: <User size={18} />,
        title:
          viewedProfile?.display_name ||
          viewedProfile?.name ||
          "Profile",
      };
    }

    // Sidebar-mode based
    if (sidebarMode === "spaces") {
      if (activeSpaceId === "__friends_feed__") {
        return { icon: <Users size={18} />, title: "Friends Feed" };
      }
      const space = spaces.find((s) => s.id === activeSpaceId);
      if (!space) {
        return { icon: <LayoutGrid size={18} />, title: "Spaces" };
      }
      const channelPart = activeChannelId
        ?.split(":")
        .slice(1)
        .join(":");
      const spaceChannels = activeSpaceId
        ? allChannels[activeSpaceId]
        : undefined;
      const channel = spaceChannels?.find((c) => c.id === channelPart);

      return {
        icon: space.picture ? (
          <img
            src={space.picture}
            alt=""
            className="h-5 w-5 rounded-full object-cover"
          />
        ) : (
          <LayoutGrid size={18} />
        ),
        title: space.name,
        subtitle: channel ? channel.label : undefined,
      };
    }

    if (sidebarMode === "music") {
      let title = musicViewLabels[musicView] || "Music";

      if (musicView === "album-detail" && musicDetailId) {
        const album = albums[musicDetailId];
        if (album) title = album.title;
      }
      if (musicView === "artist-detail" && artistProfile) {
        title =
          artistProfile.display_name || artistProfile.name || "Artist";
      }
      if (musicView === "playlist-detail" && musicDetailId) {
        const playlist = playlists[musicDetailId];
        if (playlist) title = playlist.title;
      }

      return { icon: <Music2 size={18} />, title };
    }

    if (sidebarMode === "messages") {
      if (dmPubkey && dmProfile) {
        return {
          icon: <MessageCircle size={18} />,
          title:
            dmProfile.display_name || dmProfile.name || "Messages",
        };
      }
      return { icon: <MessageCircle size={18} />, title: "Messages" };
    }

    return { icon: <LayoutGrid size={18} />, title: "The Wired" };
  }

  const showPanelToggle = context !== "none";

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "relative z-10 flex items-center border-b border-border glass",
        isTauriMacOS ? "h-[78px] pt-[30px]" : "h-12",
      )}
    >
      {/* Left section: sidebar toggle + nav buttons + location title */}
      <div className="flex items-center gap-1 pl-2">
        <Button variant="ghost" size="sm" onClick={onToggleSidebar}>
          {sidebarExpanded ? (
            <PanelLeftClose size={18} />
          ) : (
            <PanelLeftOpen size={18} />
          )}
        </Button>

        {/* Back / Forward */}
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-soft"
          title="Go back"
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
        </button>
        <button
          onClick={goForward}
          disabled={!canGoForward}
          className="rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-soft"
          title="Go forward"
        >
          <ArrowRight size={16} strokeWidth={2.5} />
        </button>

        {/* Separator */}
        <div className="mx-2 h-4 w-px bg-border" />

        {/* Location indicator */}
        <div className="flex items-center gap-2 text-heading">
          <span className="flex-shrink-0 text-soft">{loc.icon}</span>
          <span className="text-sm font-semibold tracking-wide truncate max-w-[200px]">
            {loc.title}
          </span>
          {loc.subtitle && (
            <>
              <span className="text-xs text-muted">/</span>
              <span className="text-sm text-soft truncate max-w-[160px]">
                {loc.subtitle}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Logo in titlebar overlay zone */}
      {isTauriMacOS && (
        <div className="absolute top-0 left-0 right-0 h-[30px] flex items-center justify-center pointer-events-none">
          <img src="/logo.png" alt="" className="h-4 w-4 rounded opacity-50" draggable={false} />
        </div>
      )}

      {/* Right section: search, notifications, theme, panel toggle */}
      <div className="ml-auto flex items-center gap-3 pr-3">
        {sidebarMode === "music" ? <SearchInput /> : <UserSearchInput />}
        <NotificationBell />
        <ThemeQuickPicker />
        {showPanelToggle && (
          <Button variant="ghost" size="sm" onClick={toggle}>
            {isOpen ? (
              <PanelRightClose size={18} />
            ) : (
              <PanelRightOpen size={18} />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
