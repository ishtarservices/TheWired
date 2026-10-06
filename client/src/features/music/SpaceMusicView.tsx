import { useEffect, useMemo, useRef, useState } from "react";
import { Music, Upload, Search, LayoutGrid, List, RefreshCw, Play } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { TrackCard } from "./TrackCard";
import { TrackRow } from "./TrackRow";
import { AlbumCard } from "./AlbumCard";
import { SpaceAlbumDetail } from "./SpaceAlbumDetail";
import { UploadTrackModal } from "./UploadTrackModal";
import { ShelfLinkCard } from "./ShelfLinkCard";
import { ShelfAttributionLine } from "./ShelfAttribution";
import { SortDropdown } from "./MusicSortBar";
import { useAudioPlayer } from "./useAudioPlayer";
import {
  TRACK_SORT_OPTIONS,
  ALBUM_SORT_OPTIONS,
  sortTracks,
  sortAlbums,
  filterTracks,
  filterAlbums,
  defaultDir,
  flipDir,
} from "./sortMusic";
import {
  buildShelf,
  collapseMemberTracks,
  pendingRefs,
  sortShelfNewest,
  type ShelfItem,
} from "./shelf";
import type { TrackSortKey, AlbumSortKey, SortDir } from "@/types/music";
import { EVENT_KINDS } from "@/types/nostr";
import { parseChannelIdPart } from "@/features/spaces/spaceSelectors";
import { useFeedPagination } from "@/features/spaces/useFeedPagination";
import { LoadMoreButton } from "@/features/spaces/LoadMoreButton";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";

type Tab = "all" | "tracks" | "albums" | "links";
type ViewMode = "grid" | "list";

const EMPTY_IDS: string[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();

/** Album sort for the mixed "All" view follows the track sort where the keys overlap. */
function albumKeyFor(trackKey: TrackSortKey): AlbumSortKey {
  return trackKey === "duration" ? "tracks" : trackKey;
}

/**
 * A space's music channel as a shelf (soot parity, WIR-146): members'
 * releases the placement rules put here, merged with kind-9 posts INTO the
 * channel (`a`/`k` for a release, `r` for a provider link) carrying poster
 * attribution and a note. Private releases never show; in "All" a track folds
 * into its project when the project is on the shelf.
 */
export function SpaceMusicView() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpace = useAppSelector((s) => {
    const id = s.spaces.activeSpaceId;
    return id ? s.spaces.list.find((sp) => sp.id === id) : undefined;
  });
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const muteList = useAppSelector((s) => s.identity.muteList);
  const allChannels = useAppSelector((s) => activeSpace ? s.spaces.channels[activeSpace.id] : undefined);
  const activeChannelIdPart = activeChannelId ? parseChannelIdPart(activeChannelId) : undefined;
  const activeChannel = allChannels?.find((c) => c.id === activeChannelIdPart);
  const isCurated = activeChannel?.feedMode === "curated";
  const { meta, refresh, loadMore } = useFeedPagination("music", activeChannelIdPart);
  const feedEventIds = useAppSelector(
    (s) => (activeChannelId ? s.events.spaceFeeds[activeChannelId] : undefined) ?? EMPTY_IDS,
  );
  // kind-9 posts into this channel live in the chat index under the same key.
  const postEventIds = useAppSelector(
    (s) => (activeChannelId ? s.events.chatMessages[activeChannelId] : undefined) ?? EMPTY_IDS,
  );
  const deletedMessageIds = useAppSelector((s) => s.events.deletedMessageIds);
  const eventEntities = useAppSelector((s) => s.events.entities);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const { playQueue } = useAudioPlayer();

  const [tab, setTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<TrackSortKey>("added");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [albumSortKey, setAlbumSortKey] = useState<AlbumSortKey>("added");
  const [albumSortDir, setAlbumSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [inlineAlbumId, setInlineAlbumId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const mutedSet = useMemo<ReadonlySet<string>>(() => {
    const s = new Set<string>();
    for (const m of muteList) if (m.type === "pubkey") s.add(m.value);
    return s.size ? s : EMPTY_SET;
  }, [muteList]);

  // ── Shelf ────────────────────────────────────────────────────────────
  const shelf = useMemo<ShelfItem[]>(() => {
    const feedTracks = [];
    const feedAlbums = [];
    for (const eventId of feedEventIds) {
      const event = eventEntities[eventId];
      if (!event) continue;
      const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
      if (event.kind === EVENT_KINDS.MUSIC_TRACK) {
        const t = tracks[`31683:${event.pubkey}:${dTag}`];
        // Audio dropped into a note stays with the note unless it was placed
        // here explicitly (soot rule).
        if (t && (t.inCatalog !== false || t.channelId === activeChannelIdPart)) feedTracks.push(t);
      } else if (event.kind === EVENT_KINDS.MUSIC_ALBUM) {
        const a = albums[`33123:${event.pubkey}:${dTag}`];
        if (a) feedAlbums.push(a);
      }
    }
    const posts = [];
    for (const id of postEventIds) {
      if (deletedMessageIds[id]) continue;
      const ev = eventEntities[id];
      if (ev && ev.kind === EVENT_KINDS.CHAT_MESSAGE) posts.push(ev);
    }
    return sortShelfNewest(
      buildShelf({
        tracks: feedTracks,
        albums: feedAlbums,
        posts,
        resolvedTracks: tracks,
        resolvedAlbums: albums,
        muted: mutedSet,
        spaceId: activeSpace?.id,
      }),
    );
  }, [feedEventIds, postEventIds, deletedMessageIds, eventEntities, tracks, albums, mutedSet, activeSpace?.id, activeChannelIdPart]);

  // Posted refs the catalog hasn't seen: ask the host relay once per ref.
  const requestedRefs = useRef(new Set<string>());
  useEffect(() => {
    const hostRelay = activeSpace?.hostRelay;
    if (!hostRelay) return;
    const missing = pendingRefs(shelf).filter((ref) => !requestedRefs.current.has(ref));
    if (missing.length === 0) return;
    const groups = new Map<string, string[]>();
    for (const ref of missing) {
      requestedRefs.current.add(ref);
      const [kind, author, ...d] = ref.split(":");
      const key = `${kind}:${author}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(d.join(":"));
    }
    const filters = [...groups].map(([key, dTags]) => {
      const [kind, author] = key.split(":");
      return { kinds: [parseInt(kind, 10)], authors: [author], "#d": dTags };
    });
    void subscriptionManager.subscribeOnce({ filters, relayUrls: [hostRelay] });
  }, [shelf, activeSpace?.hostRelay]);

  // ── Derived lists ────────────────────────────────────────────────────
  const shelfForTab = tab === "all" ? collapseMemberTracks(shelf) : shelf;
  const trackRows = useMemo(
    () => shelfForTab.filter((r): r is Extract<ShelfItem, { kind: "track" }> => r.kind === "track"),
    [shelfForTab],
  );
  const albumRows = useMemo(
    () => shelf.filter((r): r is Extract<ShelfItem, { kind: "album" }> => r.kind === "album"),
    [shelf],
  );
  const linkRows = useMemo(
    () => shelf.filter((r): r is Extract<ShelfItem, { kind: "external" }> => r.kind === "external"),
    [shelf],
  );
  const attributionByKey = useMemo(() => {
    const m = new Map<string, ShelfItem["postedBy"]>();
    for (const r of shelf) if (r.postedBy.length) m.set(r.key, r.postedBy);
    return m;
  }, [shelf]);

  const filteredTracks = useMemo(
    () => sortTracks(filterTracks(trackRows.map((r) => r.track), searchQuery), sortKey, sortDir),
    [trackRows, searchQuery, sortKey, sortDir],
  );
  const effectiveAlbumKey = tab === "albums" ? albumSortKey : albumKeyFor(sortKey);
  const effectiveAlbumDir = tab === "albums" ? albumSortDir : sortDir;
  const filteredAlbums = useMemo(
    () => sortAlbums(filterAlbums(albumRows.map((r) => r.album), searchQuery), effectiveAlbumKey, effectiveAlbumDir),
    [albumRows, searchQuery, effectiveAlbumKey, effectiveAlbumDir],
  );
  const filteredLinks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return linkRows.filter(
      (r) => !q || (r.media.title ?? r.media.canonicalUrl).toLowerCase().includes(q) || r.media.provider.includes(q),
    );
  }, [linkRows, searchQuery]);

  const allTrackCount = shelf.filter((r) => r.kind === "track").length;
  const hasContent = shelf.length > 0;
  const isMember = !!pubkey && activeSpace?.mode === "read-write";
  const uploadChannelId = isCurated ? activeChannel?.id : undefined;

  // Play-all queues every track on the shelf (not the collapsed grid).
  const allTrackIds = useMemo(
    () => sortTracks(shelf.filter((r): r is Extract<ShelfItem, { kind: "track" }> => r.kind === "track").map((r) => r.track), sortKey, sortDir).map((t) => t.addressableId),
    [shelf, sortKey, sortDir],
  );

  // Inline album detail
  if (inlineAlbumId) {
    return (
      <SpaceAlbumDetail
        albumId={inlineAlbumId}
        onBack={() => setInlineAlbumId(null)}
      />
    );
  }

  const uploadModal = uploadOpen && (
    <UploadTrackModal
      open={uploadOpen}
      onClose={() => setUploadOpen(false)}
      defaultVisibility="space"
      defaultSpaceId={activeSpace?.id}
      defaultChannelId={uploadChannelId}
    />
  );

  // Empty state
  if (!hasContent) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Music size={32} className="text-muted" />
        <p className="text-sm text-soft">
          {isCurated ? "Nothing on this shelf yet" : "No music yet from space members"}
        </p>
        {isMember && (
          <button
            onClick={() => setUploadOpen(true)}
            className="mt-1 flex items-center gap-1.5 rounded-full bg-gradient-to-r from-primary to-primary-soft px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 press-effect"
          >
            <Upload size={14} />
            Upload Track
          </button>
        )}
        {uploadModal}
      </div>
    );
  }

  const showTracks = tab === "all" || tab === "tracks";
  const showAlbums = tab === "all" || tab === "albums";
  const showLinks = tab === "all" || tab === "links";
  const filteredTrackIds = filteredTracks.map((t) => t.addressableId);
  const tabs: Tab[] = linkRows.length > 0 ? ["all", "tracks", "albums", "links"] : ["all", "tracks", "albums"];
  const tabCount = (t: Tab) =>
    t === "all" ? collapseMemberTracks(shelf).length
    : t === "tracks" ? allTrackCount
    : t === "albums" ? albumRows.length
    : linkRows.length;
  const tabLabel = (t: Tab) =>
    t === "all" ? "All" : t === "tracks" ? "Tracks" : t === "albums" ? "Projects" : "Links";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        {/* Tabs */}
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-primary/20 text-primary"
                  : "text-soft hover:bg-surface hover:text-heading"
              }`}
            >
              {tabLabel(t)} <span className="text-muted">({tabCount(t)})</span>
            </button>
          ))}
        </div>

        {isCurated && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            Curated
          </span>
        )}

        {allTrackIds.length > 0 && (
          <button
            onClick={() => playQueue(allTrackIds, 0)}
            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-soft transition-colors hover:border-border-light hover:text-heading"
            title="Play every track on this shelf"
          >
            <Play size={11} fill="currentColor" />
            Play all
          </button>
        )}

        {/* Search */}
        <div className="relative ml-auto flex items-center">
          <Search size={13} className="absolute left-2.5 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter..."
            className="w-36 rounded-full border border-border bg-field pl-8 pr-3 py-1 text-xs text-heading placeholder-muted outline-none focus:border-primary/30 focus:w-48 transition-all"
          />
        </div>

        {/* Sort — the library's keys (genre, duration, released, …) */}
        {tab === "albums" ? (
          <SortDropdown
            value={albumSortKey}
            dir={albumSortDir}
            options={ALBUM_SORT_OPTIONS}
            onChangeKey={(k) => { setAlbumSortKey(k); setAlbumSortDir(defaultDir(k)); }}
            onToggleDir={() => setAlbumSortDir(flipDir(albumSortDir))}
          />
        ) : tab !== "links" ? (
          <SortDropdown
            value={sortKey}
            dir={sortDir}
            options={TRACK_SORT_OPTIONS}
            onChangeKey={(k) => { setSortKey(k); setSortDir(defaultDir(k)); }}
            onToggleDir={() => setSortDir(flipDir(sortDir))}
          />
        ) : null}

        {/* View toggle */}
        {showTracks && (
          <div className="flex gap-0.5 rounded-full border border-border p-0.5">
            <button
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              className={`rounded-full p-1 transition-colors ${viewMode === "grid" ? "bg-surface text-heading" : "text-muted hover:text-heading"}`}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              aria-label="List view"
              className={`rounded-full p-1 transition-colors ${viewMode === "list" ? "bg-surface text-heading" : "text-muted hover:text-heading"}`}
            >
              <List size={13} />
            </button>
          </div>
        )}

        {/* Refresh */}
        <button
          onClick={refresh}
          disabled={meta.isRefreshing}
          className="rounded-full p-1 text-muted transition-colors hover:text-heading disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={13} className={meta.isRefreshing ? "animate-spin" : ""} />
        </button>

        {/* Upload */}
        {isMember && (
          <button
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-soft transition-colors hover:border-border-light hover:text-heading"
          >
            <Upload size={12} />
            Upload
          </button>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
        {showTracks && filteredTracks.length > 0 && (
          <section className="mb-6">
            {tab === "all" && (
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                Tracks ({filteredTracks.length})
              </h3>
            )}
            {viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {filteredTracks.map((track, i) => {
                  const postedBy = attributionByKey.get(track.addressableId);
                  return (
                    <div key={track.addressableId} className="flex flex-col">
                      <TrackCard track={track} queueTracks={filteredTrackIds} queueIndex={i} />
                      {postedBy && <ShelfAttributionLine postedBy={postedBy} className="px-1" />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div>
                {filteredTracks.map((track, i) => {
                  const postedBy = attributionByKey.get(track.addressableId);
                  return (
                    <div key={track.addressableId}>
                      <TrackRow track={track} index={i} queueTracks={filteredTrackIds} />
                      {postedBy && <ShelfAttributionLine postedBy={postedBy} className="-mt-1 mb-1 pl-[3.5rem]" />}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {showAlbums && filteredAlbums.length > 0 && (
          <section className="mb-6">
            {tab === "all" && (
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                Projects ({filteredAlbums.length})
              </h3>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filteredAlbums.map((album) => {
                const postedBy = attributionByKey.get(album.addressableId);
                return (
                  <div key={album.addressableId} className="flex flex-col">
                    <AlbumCard album={album} onNavigate={() => setInlineAlbumId(album.addressableId)} />
                    {postedBy && <ShelfAttributionLine postedBy={postedBy} className="px-1" />}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {showLinks && filteredLinks.length > 0 && (
          <section>
            {tab === "all" && (
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
                Links ({filteredLinks.length})
              </h3>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filteredLinks.map((row) => (
                <ShelfLinkCard
                  key={row.key}
                  media={row.media}
                  footer={<ShelfAttributionLine postedBy={row.postedBy} />}
                />
              ))}
            </div>
          </section>
        )}

        {filteredTracks.length === 0 && filteredAlbums.length === 0 && filteredLinks.length === 0 && searchQuery && (
          <div className="flex flex-1 items-center justify-center py-12">
            <p className="text-sm text-soft">No results for "{searchQuery}"</p>
          </div>
        )}

        <LoadMoreButton isLoading={meta.isLoadingMore} hasMore={meta.hasMore} onLoadMore={loadMore} />
      </div>

      {uploadModal}
    </div>
  );
}
