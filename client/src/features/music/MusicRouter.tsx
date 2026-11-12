import { useEffect, useLayoutEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMusicView } from "@/store/slices/musicSlice";
import { selectFeatureEnabled, FEATURE_MUSIC_INSIGHTS } from "@/store/slices/featuresSlice";
import type { MusicView } from "@/types/music";
import { MUSIC_DETAIL_VIEWS } from "@/hooks/useNavigationHistory";
import { MusicHome } from "./views/MusicHome";
import { SongList } from "./views/SongList";
import { AlbumGrid } from "./views/AlbumGrid";
import { ArtistList } from "./views/ArtistList";
import { FolderList } from "./views/FolderList";
import { FolderDetail } from "./views/FolderDetail";
import { ArtistDetail } from "./views/ArtistDetail";
import { AlbumDetail } from "./views/AlbumDetail";
import { PublishedFolderDetail } from "./views/PublishedFolderDetail";
import { RecentlyAdded } from "./views/RecentlyAdded";
import { FavoritesList } from "./views/FavoritesList";
import { MyUploads } from "./views/MyUploads";
import { ExploreMusic } from "./views/ExploreMusic";
import { SearchResults } from "./views/SearchResults";
import { ProjectHistory } from "./views/ProjectHistory";
// TODO: Re-enable proposals/changes system later
// import { ProjectProposals } from "./views/ProjectProposals";
import { InsightsDashboard } from "./views/InsightsDashboard";
import { ListenRequests } from "./views/ListenRequests";

const VIEW_COMPONENTS: Record<MusicView, React.ComponentType> = {
  home: MusicHome,
  "recently-added": RecentlyAdded,
  favorites: FavoritesList,
  artists: ArtistList,
  albums: AlbumGrid,
  songs: SongList,
  folders: FolderList,
  "folder-detail": FolderDetail,
  "my-uploads": MyUploads,
  explore: ExploreMusic,
  "for-you": ExploreMusic,
  "artist-detail": ArtistDetail,
  "album-detail": AlbumDetail,
  "published-folder": PublishedFolderDetail,
  search: SearchResults,
  "project-history": ProjectHistory,
  // TODO: Re-enable proposals/changes system later
  // "project-proposals": ProjectProposals,
  "listen-requests": ListenRequests,
  insights: InsightsDashboard,
};

/**
 * Keep-alive music router.
 * Uses the same CSS display:none pattern as ChannelPanel.tsx
 * to preserve scroll positions and component state across view switches.
 */
export function MusicRouter() {
  const dispatch = useAppDispatch();
  const activeView = useAppSelector((s) => s.music.activeView);
  const insightsEnabled = useAppSelector(selectFeatureEnabled(FEATURE_MUSIC_INSIGHTS));
  const activeDetailId = useAppSelector((s) => s.music.activeDetailId);
  const visitedRef = useRef(new Set<MusicView>());
  const activeRef = useRef<HTMLDivElement>(null);

  // Each detail view is one kept-alive component that shows whichever project,
  // artist or folder is open, so it would otherwise keep the scroll offset of
  // the last one. A different thing starts at the top. Sections (Home,
  // Explore, the lists) are left alone: returning to one is meant to land
  // where you were.
  useLayoutEffect(() => {
    if (!MUSIC_DETAIL_VIEWS.has(activeView)) return;
    activeRef.current?.querySelector(".overflow-y-auto")?.scrollTo({ top: 0 });
  }, [activeView, activeDetailId]);

  // Insights is optional (Settings → Features). Switching it off while the
  // page is open would leave a view with no way back to it in the sidebar.
  useEffect(() => {
    if (activeView === "insights" && !insightsEnabled) dispatch(setMusicView("home"));
  }, [activeView, insightsEnabled, dispatch]);
  visitedRef.current.add(activeView);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {[...visitedRef.current].map((view) => {
        const Component = VIEW_COMPONENTS[view];
        if (!Component) return null;
        const isActive = view === activeView;

        return (
          <div
            key={view}
            ref={isActive ? activeRef : undefined}
            className={isActive ? "flex flex-1 overflow-hidden" : "hidden"}
          >
            <Component />
          </div>
        );
      })}
    </div>
  );
}
