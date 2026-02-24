import { useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import type { MusicView } from "@/types/music";
import { MusicHome } from "./views/MusicHome";
import { SongList } from "./views/SongList";
import { AlbumGrid } from "./views/AlbumGrid";
import { ArtistList } from "./views/ArtistList";
import { PlaylistList } from "./views/PlaylistList";
import { ArtistDetail } from "./views/ArtistDetail";
import { AlbumDetail } from "./views/AlbumDetail";
import { PlaylistDetail } from "./views/PlaylistDetail";
import { RecentlyAdded } from "./views/RecentlyAdded";
import { MyUploads } from "./views/MyUploads";

const VIEW_COMPONENTS: Record<MusicView, React.ComponentType> = {
  home: MusicHome,
  "recently-added": RecentlyAdded,
  artists: ArtistList,
  albums: AlbumGrid,
  songs: SongList,
  playlists: PlaylistList,
  "my-uploads": MyUploads,
  "artist-detail": ArtistDetail,
  "album-detail": AlbumDetail,
  "playlist-detail": PlaylistDetail,
};

/**
 * Keep-alive music router.
 * Uses the same CSS display:none pattern as ChannelPanel.tsx
 * to preserve scroll positions and component state across view switches.
 */
export function MusicRouter() {
  const activeView = useAppSelector((s) => s.music.activeView);
  const visitedRef = useRef(new Set<MusicView>());
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
            className={isActive ? "flex flex-1 overflow-hidden" : "hidden"}
          >
            <Component />
          </div>
        );
      })}
    </div>
  );
}
