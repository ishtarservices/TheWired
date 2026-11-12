import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Home, Clock, Heart, Users, Disc3, Music, Folder, FolderUp, Compass, BarChart3, Inbox } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMusicView } from "@/store/slices/musicSlice";
import type { MusicView } from "@/types/music";
import { useIncomingListenRequests } from "./useListenRequests";
import { selectFeatureEnabled, FEATURE_MUSIC_INSIGHTS } from "@/store/slices/featuresSlice";
import { MUSIC_DETAIL_VIEWS, isMusicSection, useNavigationTrail } from "@/hooks/useNavigationHistory";

interface NavItem {
  view: MusicView;
  label: string;
  icon: typeof Home;
  requiresAuth?: boolean;
}

const navItems: NavItem[] = [
  { view: "home", label: "Home", icon: Home },
  { view: "explore", label: "Explore", icon: Compass },
  { view: "recently-added", label: "Recently Added", icon: Clock },
  { view: "favorites", label: "Favorites", icon: Heart },
  { view: "artists", label: "Artists", icon: Users },
  { view: "albums", label: "Projects", icon: Disc3 },
  { view: "songs", label: "Songs", icon: Music },
  { view: "folders", label: "Folders", icon: Folder },
  { view: "insights" as MusicView, label: "Insights", icon: BarChart3, requiresAuth: true },
  { view: "listen-requests", label: "Listen Requests", icon: Inbox, requiresAuth: true },
];

export function MusicSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const activeView = useAppSelector((s) => s.music.activeView);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { groups: listenRequests } = useIncomingListenRequests();
  const insightsEnabled = useAppSelector(selectFeatureEnabled(FEATURE_MUSIC_INSIGHTS));

  // A project, artist or folder page belongs to wherever it was opened from.
  // While one is open the sidebar keeps that section marked, so opening
  // something from Home doesn't read as having left Home. Opened from outside
  // the music section (Discover, a post, a space), nothing here is marked.
  const { origin } = useNavigationTrail();
  const onDetail = MUSIC_DETAIL_VIEWS.has(activeView);
  const originView = origin && isMusicSection(origin) ? origin.musicView : null;
  const section: MusicView | null = onDetail ? originView : activeView;

  const handleNav = (view: MusicView) => {
    dispatch(setMusicView(view));
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="space-y-0.5 p-2">
        <div className="label-caps px-2 pb-2 pt-2">
          Music
        </div>
        {navItems.map((item) => {
          if (item.requiresAuth && !pubkey) return null;
          // Insights is an optional feature (Settings → Features).
          if (item.view === "insights" && !insightsEnabled) return null;
          // Listen Requests is an inbox: it appears when someone has asked,
          // and stays while you are looking at it.
          if (
            item.view === "listen-requests" &&
            listenRequests.length === 0 &&
            activeView !== "listen-requests"
          ) {
            return null;
          }
          const isActive = section === item.view || (item.view === "explore" && section === "for-you");
          return (
            <button
              key={item.view}
              onClick={() => handleNav(item.view)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150",
                isActive
                  ? "bg-surface-hover text-heading"
                  : "text-soft hover:bg-surface hover:text-heading",
              )}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
              {item.view === "listen-requests" && listenRequests.length > 0 && (
                <span
                  className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary"
                  aria-label={`${listenRequests.length} open listen requests`}
                >
                  {listenRequests.length > 99 ? "99+" : listenRequests.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {pubkey && (
        <div className="mt-auto border-t border-border-light p-2">
          <button
            onClick={() => handleNav("my-uploads")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
              section === "my-uploads"
                ? "bg-surface-hover text-heading"
                : "text-soft hover:bg-surface hover:text-heading",
            )}
          >
            <FolderUp size={16} />
            <span>My Music</span>
          </button>
        </div>
      )}
    </div>
  );
}
