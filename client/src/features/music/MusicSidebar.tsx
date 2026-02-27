import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Home, Clock, Users, Disc3, Music, ListMusic, Upload, FolderUp } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMusicView } from "@/store/slices/musicSlice";
import { UploadTrackModal } from "./UploadTrackModal";
import type { MusicView } from "@/types/music";

interface NavItem {
  view: MusicView;
  label: string;
  icon: typeof Home;
  requiresAuth?: boolean;
}

const navItems: NavItem[] = [
  { view: "home", label: "Home", icon: Home },
  { view: "recently-added", label: "Recently Added", icon: Clock },
  { view: "artists", label: "Artists", icon: Users },
  { view: "albums", label: "Projects", icon: Disc3 },
  { view: "songs", label: "Songs", icon: Music },
  { view: "playlists", label: "Playlists", icon: ListMusic },
  { view: "my-uploads", label: "My Music", icon: FolderUp, requiresAuth: true },
];

export function MusicSidebar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const activeView = useAppSelector((s) => s.music.activeView);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [uploadOpen, setUploadOpen] = useState(false);

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
          const isActive =
            activeView === item.view;
          return (
            <button
              key={item.view}
              onClick={() => handleNav(item.view)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-150",
                isActive
                  ? "bg-pulse/8 text-heading"
                  : "text-soft hover:bg-white/[0.03] hover:text-heading",
              )}
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto p-2">
        <button
          onClick={() => setUploadOpen(true)}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-white/[0.04] px-2 py-1.5 text-sm text-soft transition-colors hover:border-pulse/40 hover:text-heading"
        >
          <Upload size={16} />
          <span>Upload</span>
        </button>
      </div>

      <UploadTrackModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
