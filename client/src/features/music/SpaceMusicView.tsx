import { useMemo, useState } from "react";
import { Music, Upload, Search, LayoutGrid, List, ArrowUpDown } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { TrackCard } from "./TrackCard";
import { TrackRow } from "./TrackRow";
import { AlbumCard } from "./AlbumCard";
import { SpaceAlbumDetail } from "./SpaceAlbumDetail";
import { UploadTrackModal } from "./UploadTrackModal";
import { EVENT_KINDS } from "@/types/nostr";

type Tab = "all" | "tracks" | "albums";
type SortMode = "newest" | "az" | "artist";
type ViewMode = "grid" | "list";

export function SpaceMusicView() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpace = useAppSelector((s) => {
    const id = s.spaces.activeSpaceId;
    return id ? s.spaces.list.find((sp) => sp.id === id) : undefined;
  });
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const feedEventIds = useAppSelector(
    (s) => (activeChannelId ? s.events.spaceFeeds[activeChannelId] : undefined) ?? [],
  );
  const eventEntities = useAppSelector((s) => s.events.entities);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);

  const [tab, setTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [inlineAlbumId, setInlineAlbumId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { trackItems, albumItems } = useMemo(() => {
    const trackSet = new Set<string>();
    const albumSet = new Set<string>();

    for (const eventId of feedEventIds) {
      const event = eventEntities[eventId];
      if (!event) continue;

      if (event.kind === EVENT_KINDS.MUSIC_TRACK) {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
        const addrId = `31683:${event.pubkey}:${dTag}`;
        if (tracks[addrId]) trackSet.add(addrId);
      } else if (event.kind === EVENT_KINDS.MUSIC_ALBUM) {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
        const addrId = `33123:${event.pubkey}:${dTag}`;
        if (albums[addrId]) albumSet.add(addrId);
      }
    }

    return { trackItems: [...trackSet], albumItems: [...albumSet] };
  }, [feedEventIds, eventEntities, tracks, albums]);

  // Filter + sort tracks
  const filteredTracks = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let items = trackItems
      .map((id) => tracks[id])
      .filter(Boolean)
      .filter((t) =>
        !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
      );

    if (sortMode === "az") items.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === "artist") items.sort((a, b) => a.artist.localeCompare(b.artist));
    else items.sort((a, b) => b.createdAt - a.createdAt);

    return items;
  }, [trackItems, tracks, searchQuery, sortMode]);

  // Filter + sort albums
  const filteredAlbums = useMemo(() => {
    const q = searchQuery.toLowerCase();
    let items = albumItems
      .map((id) => albums[id])
      .filter(Boolean)
      .filter((a) =>
        !q || a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q),
      );

    if (sortMode === "az") items.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === "artist") items.sort((a, b) => a.artist.localeCompare(b.artist));
    else items.sort((a, b) => b.createdAt - a.createdAt);

    return items;
  }, [albumItems, albums, searchQuery, sortMode]);

  const hasContent = trackItems.length > 0 || albumItems.length > 0;
  const isMember = !!pubkey && activeSpace?.mode === "read-write";

  // Inline album detail
  if (inlineAlbumId) {
    return (
      <SpaceAlbumDetail
        albumId={inlineAlbumId}
        onBack={() => setInlineAlbumId(null)}
      />
    );
  }

  // Empty state
  if (!hasContent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Music size={32} className="text-muted" />
        <p className="text-sm text-soft">No music yet from space members</p>
        {isMember && (
          <button
            onClick={() => setUploadOpen(true)}
            className="mt-1 flex items-center gap-1.5 rounded-full bg-gradient-to-r from-pulse to-pulse-soft px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 press-effect"
          >
            <Upload size={14} />
            Upload Track
          </button>
        )}
        {uploadOpen && (
          <UploadTrackModal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            defaultVisibility="space"
            defaultSpaceId={activeSpace?.id}
          />
        )}
      </div>
    );
  }

  const showTracks = tab === "all" || tab === "tracks";
  const showAlbums = tab === "all" || tab === "albums";
  const filteredTrackIds = filteredTracks.map((t) => t.addressableId);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-2">
        {/* Tabs */}
        <div className="flex gap-1">
          {(["all", "tracks", "albums"] as Tab[]).map((t) => {
            const count =
              t === "all"
                ? trackItems.length + albumItems.length
                : t === "tracks"
                  ? trackItems.length
                  : albumItems.length;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  tab === t
                    ? "bg-pulse/20 text-pulse"
                    : "text-soft hover:bg-surface hover:text-heading"
                }`}
              >
                {t === "all" ? "All" : t === "tracks" ? "Tracks" : "Albums"}{" "}
                <span className="text-muted">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative ml-auto flex items-center">
          <Search size={13} className="absolute left-2.5 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter..."
            className="w-36 rounded-full border border-edge bg-field pl-8 pr-3 py-1 text-xs text-heading placeholder-muted outline-none focus:border-pulse/30 focus:w-48 transition-all"
          />
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="appearance-none rounded-full border border-edge bg-field pl-7 pr-3 py-1 text-xs text-heading outline-none focus:border-pulse/30"
          >
            <option value="newest">Newest</option>
            <option value="az">A-Z</option>
            <option value="artist">Artist</option>
          </select>
          <ArrowUpDown size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </div>

        {/* View toggle */}
        {showTracks && (
          <div className="flex gap-0.5 rounded-full border border-edge p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              className={`rounded-full p-1 transition-colors ${viewMode === "grid" ? "bg-surface text-heading" : "text-muted hover:text-heading"}`}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`rounded-full p-1 transition-colors ${viewMode === "list" ? "bg-surface text-heading" : "text-muted hover:text-heading"}`}
            >
              <List size={13} />
            </button>
          </div>
        )}

        {/* Upload */}
        {isMember && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-edge px-3 py-1 text-xs text-soft transition-colors hover:border-edge-light hover:text-heading"
          >
            <Upload size={12} />
            Upload
          </button>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
        {showTracks && filteredTracks.length > 0 && (
          <section className={showAlbums && filteredAlbums.length > 0 ? "mb-6" : ""}>
            {tab === "all" && (
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                Tracks ({filteredTracks.length})
              </h3>
            )}
            {viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filteredTracks.map((track, i) => (
                  <TrackCard
                    key={track.addressableId}
                    track={track}
                    queueTracks={filteredTrackIds}
                    queueIndex={i}
                  />
                ))}
              </div>
            ) : (
              <div>
                {filteredTracks.map((track, i) => (
                  <TrackRow
                    key={track.addressableId}
                    track={track}
                    index={i}
                    queueTracks={filteredTrackIds}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {showAlbums && filteredAlbums.length > 0 && (
          <section>
            {tab === "all" && (
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                Albums ({filteredAlbums.length})
              </h3>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filteredAlbums.map((album) => (
                <AlbumCard
                  key={album.addressableId}
                  album={album}
                  onNavigate={() => setInlineAlbumId(album.addressableId)}
                />
              ))}
            </div>
          </section>
        )}

        {filteredTracks.length === 0 && filteredAlbums.length === 0 && searchQuery && (
          <div className="flex flex-1 items-center justify-center py-12">
            <p className="text-sm text-soft">No results for "{searchQuery}"</p>
          </div>
        )}
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <UploadTrackModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          defaultVisibility="space"
          defaultSpaceId={activeSpace?.id}
        />
      )}
    </div>
  );
}
