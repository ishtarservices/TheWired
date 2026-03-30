import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Home, Clock, Heart, Users, Disc3, Music, ListMusic, FolderUp, Compass, BarChart3 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMusicView } from "@/store/slices/musicSlice";
import type { MusicView } from "@/types/music";

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
  { view: "playlists", label: "Playlists", icon: ListMusic },
  { view: "insights" as MusicView, label: "Insights", icon: BarChart3, requiresAuth: true },
];

export function MusicSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const activeView = useAppSelector((s) => s.music.activeView);
  const pubkey = useAppSelector((s) => s.identity.pubkey);

  const handleNav = (view: MusicView) => {
    dispatch(setMusicView(view));
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="space-y-0.5 p-2">
        <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
          Music
        </div>
        {navItems.map((item) => {
          if (item.requiresAuth && !pubkey) return null;
          // Highlight parent nav when viewing a detail sub-view
          const isActive =
            activeView === item.view ||
            (item.view === "albums" && (activeView === "album-detail" || activeView === "project-history")) ||
            (item.view === "artists" && activeView === "artist-detail") ||
            (item.view === "playlists" && activeView === "playlist-detail");
          return (
            <button
              key={item.view}
              onClick={() => handleNav(item.view)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                isActive
                  ? "bg-primary/8 text-heading"
                  : "text-soft hover:bg-surface hover:text-heading",
              )}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {pubkey && (
        <div className="mt-auto p-2">
          <button
            onClick={() => handleNav("my-uploads")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-150",
              activeView === "my-uploads"
                ? "bg-primary/15 text-heading"
                : "border border-dashed border-border text-soft hover:border-primary/40 hover:text-heading",
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
