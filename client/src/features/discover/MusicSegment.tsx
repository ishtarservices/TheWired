import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setSidebarMode } from "@/store/slices/uiSlice";
import {
  addAlbums,
  addTracks,
  setActiveDetailId,
  setActiveGenre,
  setActiveTag,
  setMusicView,
} from "@/store/slices/musicSlice";
import { api, getApiBaseUrl } from "@/lib/api/client";
import { browseAlbums, browseMusic, getGenres, resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { APP_RELAY } from "@/lib/nostr/constants";
import { EVENT_KINDS, type NostrEvent } from "@/types/nostr";
import type { MusicAlbum, MusicPlaylist, MusicTrack } from "@/types/music";
import { parseTrackEvent } from "@/features/music/trackParser";
import { parseAlbumEvent } from "@/features/music/albumParser";
import { getTrackImage } from "@/features/music/trackImage";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { useResolvedArtist } from "@/features/music/useResolvedArtist";
import type { MusicSearchHit } from "@/features/music/useMusicSearch";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { FacetChip, FacetRow } from "@/features/music/Facets";
import { ActiveFilter, Browse } from "./components/Browse";
import { ChipRow, type ChipOption } from "./components/ChipRow";
import { EmptyState } from "./components/EmptyState";
import { SectionHeader } from "./components/SectionHeader";
import { RowSkeleton, WallSkeleton } from "./components/Skeletons";
import { TrackRow } from "./components/TrackRow";
import { TrackTile } from "./components/TrackTile";
import { AlbumTile } from "./components/AlbumTile";
import { PublishedFolderRow } from "./components/PublishedFolderRow";
import { formatAge, rankTracks, sortDisclosure, trackSignalLabel } from "./ranking";
import { matchesScene, sceneBySlug, sceneChips } from "./taxonomy";
import { useScenes } from "./useScenes";
import { hasReachableAudio } from "./reachableAudio";

const DEBOUNCE_MS = 300;
const TRACK_LIMIT = 30;
const ALBUM_LIMIT = 12;
const PLAYLIST_LIMIT = 30;
const GENRE_CAP = 12;
const ONE_SHOT_TIMEOUT_MS = 6000;
/** Our own blob origin: its uploads count as playable even on a local stack.
 *  Read per call, since the API base can be switched at runtime. */
function ownApiOrigin(): string {
  try {
    return new URL(getApiBaseUrl()).origin;
  } catch {
    return "";
  }
}
const RELAY_RETRY_MS = 3000;

/** The cover wall: the same columns as the music section's Explore. */
const WALL = "grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-x-5 gap-y-8";
/** Ruled rows, two columns once there is room. */
const ROWS = "grid grid-cols-1 gap-x-8 @3xl:grid-cols-2";

const TRACK_UNAVAILABLE = "Track unavailable — it may live outside your relays.";

type Status = "loading" | "ready" | "error";
type Source = "backend" | "relay";

interface SearchResults {
  tracks: MusicSearchHit[];
  albums: MusicSearchHit[];
}

/** No coordinate-keyed zap store exists on the desktop yet, so ranking is
 *  honest recency and the why-line is age only. */
const NO_ZAPS = {};

/**
 * Music discovery: a wall of projects, a wall of loose tracks headed
 * "Trending" only when trending actually delivered, and published folders.
 * Scenes and genres are ways in, so they live in the folded Browse block.
 * With a query of ≥2 characters it is search instead.
 */
export function MusicSegment({ query }: { query: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const scenes = useScenes();
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const { playQueue, player } = useAudioPlayer();

  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const playlists = useAppSelector((s) => s.music.playlists);

  const [status, setStatus] = useState<Status>("loading");
  const [source, setSource] = useState<Source>("backend");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trendingIds, setTrendingIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [albumIds, setAlbumIds] = useState<string[]>([]);
  const [genres, setGenres] = useState<{ genre: string; count: number }[]>([]);
  const [scene, setScene] = useState("all");
  const [reloadTick, setReloadTick] = useState(0);

  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const [playError, setPlayError] = useState<{ id: string; message: string } | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const trimmed = query.trim();
  const searchMode = trimmed.length >= 2;

  // Latest store snapshot for async handlers (resolve-then-play).
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  // ── Discovery load ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setLoadError(null);

    const ingestTracks = (raw: unknown[]): string[] => {
      const parsed = raw.map((e) => parseTrackEvent(e as NostrEvent));
      if (parsed.length > 0) dispatch(addTracks(parsed));
      for (const e of raw) processIncomingEvent(e, "browse").catch(() => {});
      return parsed.map((t) => t.addressableId);
    };
    const ingestAlbums = (raw: unknown[]): string[] => {
      const parsed = raw.map((e) => parseAlbumEvent(e as NostrEvent));
      if (parsed.length > 0) dispatch(addAlbums(parsed));
      for (const e of raw) processIncomingEvent(e, "browse").catch(() => {});
      return parsed.map((a) => a.addressableId);
    };

    (async () => {
      // Trending rides a Redis sorted set the backend warms over time and is
      // routinely empty; recent is fetched alongside so the fallback needs no
      // second round-trip. Whichever we end up serving, the header says so.
      const [trend, recent, albs, gen] = await Promise.allSettled([
        browseMusic({ sort: "trending", limit: TRACK_LIMIT }),
        browseMusic({ sort: "recent", limit: TRACK_LIMIT }),
        browseAlbums({ sort: "recent", limit: ALBUM_LIMIT }),
        getGenres(),
      ]);
      if (cancelled) return;

      const trendRaw = trend.status === "fulfilled" ? trend.value.data.tracks : [];
      const recentRaw = recent.status === "fulfilled" ? recent.value.data.tracks : [];
      const albumRaw = albs.status === "fulfilled" ? albs.value.data.albums : [];

      if (trendRaw.length > 0 || recentRaw.length > 0 || albumRaw.length > 0) {
        setSource("backend");
        setTrendingIds(ingestTracks(trendRaw));
        setRecentIds(ingestTracks(recentRaw));
        setAlbumIds(ingestAlbums(albumRaw));
        setGenres(gen.status === "fulfilled" ? gen.value.data : []);
        setStatus("ready");
        return;
      }

      // Backend index cold or unreachable — surface recent relay releases
      // instead, and label the rails as recent. The app relay only: public
      // relays carry anyone's releases, dev/QA uploads included.
      setSource("relay");
      setTrendingIds([]);
      setRecentIds([]);
      setAlbumIds([]);
      setGenres(gen.status === "fulfilled" ? gen.value.data : []);
      try {
        await subscriptionManager.subscribeOnce({
          filters: [
            { kinds: [EVENT_KINDS.MUSIC_TRACK], limit: TRACK_LIMIT },
            { kinds: [EVENT_KINDS.MUSIC_ALBUM], limit: ALBUM_LIMIT },
          ],
          relayUrls: [APP_RELAY],
          timeoutMs: ONE_SHOT_TIMEOUT_MS,
        });
        if (cancelled) return;
        setStatus("ready");
        if (trend.status === "rejected" && recent.status === "rejected") {
          const reason = trend.reason;
          setLoadError(reason instanceof Error ? reason.message : "Couldn't load music.");
        }
      } catch {
        if (cancelled) return;
        setStatus("error");
        setLoadError("Couldn't load music.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dispatch, reloadTick]);

  // ── Playlists: community curation. No backend route exists for kind 30119,
  // so this is the one extra relay one-shot the segment allows itself. The
  // events land in the store through the pipeline; we read them from there.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async (attempt: number) => {
      const { reason } = await subscriptionManager.subscribeOnce({
        filters: [{ kinds: [EVENT_KINDS.MUSIC_PLAYLIST], limit: PLAYLIST_LIMIT }],
        timeoutMs: ONE_SHOT_TIMEOUT_MS,
      });
      if (cancelled) return;
      // Cold start: no read relay was connected yet. Retry after they dial.
      if (reason === "no-relays" && attempt < 2) {
        timer = setTimeout(() => void run(attempt + 1), RELAY_RETRY_MS);
      }
    };
    void run(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reloadTick]);

  // ── Search ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!searchMode) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      // One call, type omitted → the backend returns {tracks, albums}.
      // auth:false — the gateway's NIP-98 URL check drops query params.
      api<SearchResults>(`/search/music?q=${encodeURIComponent(trimmed)}&limit=20`, { auth: false })
        .then((res) => {
          if (seq !== searchSeq.current) return;
          setSearchResults({ tracks: res.data.tracks ?? [], albums: res.data.albums ?? [] });
          setSearchError(null);
        })
        .catch((e: unknown) => {
          if (seq !== searchSeq.current) return;
          setSearchResults({ tracks: [], albums: [] });
          setSearchError(e instanceof Error ? e.message : "Search unavailable.");
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchMode, trimmed]);

  // ── Derived ──────────────────────────────────────────────────────────
  const pick = useCallback(
    (ids: string[]) => ids.map((id) => tracks[id]).filter((t): t is MusicTrack => !!t),
    [tracks],
  );

  const publicStoreTracks = useMemo(() => {
    if (source !== "relay") return [];
    const origin = ownApiOrigin();
    return (
      Object.values(tracks)
        // The store also holds tracks from feeds and other relays, so the
        // discovery bar applies here too: public, listed, and playable.
        .filter((t) => t.visibility === "public" && t.inCatalog !== false && hasReachableAudio(t, origin))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, TRACK_LIMIT)
    );
  }, [source, tracks]);
  const publicStoreAlbums = useMemo(
    () =>
      source === "relay"
        ? Object.values(albums)
            .filter((a) => a.visibility === "public")
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, ALBUM_LIMIT)
        : [],
    [source, albums],
  );

  const trendingTracks = useMemo(() => pick(trendingIds), [pick, trendingIds]);
  const trendingDelivered = trendingTracks.length > 0;
  const rawTracks = trendingDelivered
    ? trendingTracks
    : source === "relay"
      ? publicStoreTracks
      : pick(recentIds);
  const rawAlbums = useMemo(
    () =>
      source === "relay"
        ? publicStoreAlbums
        : albumIds.map((id) => albums[id]).filter((a): a is MusicAlbum => !!a),
    [source, publicStoreAlbums, albumIds, albums],
  );

  const activeScene = scene === "all" ? null : (sceneBySlug(scenes, scene) ?? null);
  const inScene = useCallback(
    (item: { genre?: string; hashtags: string[] }) =>
      !activeScene || matchesScene(activeScene, { genre: item.genre, tags: item.hashtags }),
    [activeScene],
  );

  // Recency baseline with a (currently inert) zap lift. The cold state is
  // honest recency — which is exactly what the disclosure tells the reader.
  const displayTracks = useMemo(() => rankTracks(rawTracks.filter(inScene), NO_ZAPS), [rawTracks, inScene]);
  const displayAlbums = useMemo(() => rawAlbums.filter(inScene), [rawAlbums, inScene]);

  const publicPlaylists = useMemo(
    () =>
      Object.values(playlists)
        .filter((p) => p.visibility === "public" && !p.deleted && p.trackRefs.length > 0)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, ALBUM_LIMIT),
    [playlists],
  );

  const genreList = useMemo(() => {
    if (genres.length > 0) return genres.slice(0, GENRE_CAP);
    if (source !== "relay") return [];
    const counts = new Map<string, number>();
    for (const t of publicStoreTracks) {
      if (t.genre) counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, GENRE_CAP);
  }, [genres, source, publicStoreTracks]);

  const sceneOptions = useMemo<ChipOption[]>(
    () => [
      { value: "all", label: "All" },
      ...sceneChips(scenes, {
        tags: rawTracks.flatMap((t) => t.hashtags),
        genres: genreList.map((g) => g.genre),
      }),
    ],
    [scenes, rawTracks, genreList],
  );

  // We asked for trending; if we served recency, say so instead of letting
  // recency masquerade as trending.
  const trackDisclosure = sortDisclosure("trending", trendingDelivered ? "trending" : "recent");

  // ── Actions ──────────────────────────────────────────────────────────
  const playFromList = useCallback(
    (list: MusicTrack[], index: number) => {
      setPlayError(null);
      playQueue(
        list.map((t) => t.addressableId),
        Math.max(0, index),
      );
    },
    [playQueue],
  );

  const enterMusic = useCallback(
    (payload: { view: "album-detail" | "published-folder"; id: string }) => {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveDetailId(payload));
      navigate("/");
    },
    [dispatch, navigate],
  );

  const hydrateTrackRefs = useCallback((refs: string[]) => {
    const missing = refs.filter((r) => !tracksRef.current[r]).slice(0, PLAYLIST_LIMIT);
    for (const ref of missing) {
      const [, pubkey, ...slug] = ref.split(":");
      resolveMusic("track", pubkey, slug.join(":"))
        .then((res) => processIncomingEvent((res.data as { event: unknown }).event, "resolve"))
        .catch(() => {});
    }
  }, []);

  const openAlbum = useCallback(
    (albumId: string) => {
      enterMusic({ view: "album-detail", id: albumId });
      // AlbumDetail reads its tracks from the store only; hydrate them.
      const album = albums[albumId];
      const complete = album?.trackRefs.every((r) => tracksRef.current[r]) ?? false;
      if (!complete) {
        const [, pubkey, ...slug] = albumId.split(":");
        resolveMusic("album", pubkey, slug.join(":"))
          .then(async (res) => {
            const data = res.data as { event: unknown; tracks?: unknown[] };
            await processIncomingEvent(data.event, "resolve");
            for (const t of data.tracks ?? []) await processIncomingEvent(t, "resolve");
          })
          .catch(() => {});
      }
    },
    [albums, enterMusic],
  );

  const openPlaylist = useCallback(
    (playlistId: string) => {
      enterMusic({ view: "published-folder", id: playlistId });
      const pl = playlists[playlistId];
      if (pl) hydrateTrackRefs(pl.trackRefs);
    },
    [enterMusic, hydrateTrackRefs, playlists],
  );

  const openGenre = useCallback(
    (genre: string) => {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveGenre(genre));
      dispatch(setActiveTag(null));
      dispatch(setMusicView("explore"));
      navigate("/");
    },
    [dispatch, navigate],
  );

  const openHit = useCallback(
    async (hit: MusicSearchHit, kind: "track" | "album") => {
      const id = hit.addressable_id;
      if (kind === "album") {
        openAlbum(id);
        return;
      }
      setPlayError(null);
      if (tracksRef.current[id]) {
        playQueue([id], 0);
        return;
      }
      // Search docs carry no audio URL — resolve the full event first.
      setResolvingId(id);
      try {
        const [, pubkey, ...slug] = id.split(":");
        const res = await resolveMusic("track", pubkey, slug.join(":"));
        const raw = (res.data as { event: unknown }).event;
        await processIncomingEvent(raw, "search");
        // The pipeline's dedup LRU may silently skip an already-seen id, so
        // land the parsed track explicitly before playing.
        const parsed = parseTrackEvent(raw as NostrEvent);
        dispatch(addTracks([parsed]));
        playQueue([parsed.addressableId], 0);
      } catch {
        setPlayError({ id, message: TRACK_UNAVAILABLE });
      } finally {
        setResolvingId(null);
      }
    },
    [dispatch, openAlbum, playQueue],
  );

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // ── Render: search ───────────────────────────────────────────────────
  if (searchMode) {
    const hits: { hit: MusicSearchHit; kind: "track" | "album" }[] = searchResults
      ? [
          ...searchResults.tracks.map((hit) => ({ hit, kind: "track" as const })),
          ...searchResults.albums.map((hit) => ({ hit, kind: "album" as const })),
        ]
      : [];
    return (
      <div className={cn("@container", scrollPaddingClass)}>
        {searchResults === null ? (
          <RowSkeleton count={4} />
        ) : hits.length === 0 ? (
          <EmptyState
            title={searchError ? "Search unavailable" : "No results"}
            message={searchError ?? `Nothing matched “${trimmed}”.`}
          />
        ) : (
          <div className={ROWS}>
            {hits.map(({ hit, kind }) => (
              <TrackRow
                key={`${kind}:${hit.addressable_id}`}
                title={hit.title}
                artist={hit.artist}
                imageUrl={hit.image_url}
                marker={kind === "album" ? "ALBUM" : "TRACK"}
                signal={formatAge(hit.created_at)}
                busy={resolvingId === hit.addressable_id}
                isCurrent={kind === "track" && player.currentTrackId === hit.addressable_id}
                isPlaying={player.isPlaying}
                error={playError?.id === hit.addressable_id ? playError.message : null}
                onActivate={() => void openHit(hit, kind)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Render: discovery ────────────────────────────────────────────────
  const projectsHeader = source === "relay" ? "Recent projects" : "Projects";
  const nothing =
    status === "ready" &&
    displayTracks.length === 0 &&
    displayAlbums.length === 0 &&
    publicPlaylists.length === 0;

  // An empty track wall under a wall of projects would say "No music yet"
  // right below the music. The section only reports emptiness when the
  // projects are empty too.
  const showTracks = status !== "ready" || displayTracks.length > 0 || displayAlbums.length === 0;

  // Scenes filter projects and tracks alike; genres open Explore. Both are
  // ways in rather than content, so they sit in Browse, folded by default.
  const hasScenes = sceneOptions.length > 1;
  const hasBrowse = hasScenes || genreList.length > 0;

  return (
    <div className={cn("@container space-y-9", scrollPaddingClass)}>
      {hasBrowse && (
        <Browse
          id="discover-music-browse"
          storageKey="music"
          defaultOpen={false}
          active={activeScene ? <ActiveFilter label={activeScene.label} onClear={() => setScene("all")} /> : null}
        >
          {hasScenes && (
            <FacetRow label="Scene">
              <ChipRow options={sceneOptions} value={scene} onSelect={setScene} label="Scenes" />
            </FacetRow>
          )}
          {genreList.length > 0 && (
            <FacetRow label="Genre">
              {genreList.map((g) => (
                <FacetChip key={g.genre} count={g.count} onClick={() => openGenre(g.genre)}>
                  {g.genre}
                </FacetChip>
              ))}
            </FacetRow>
          )}
        </Browse>
      )}

      {status === "loading" && (
        <section>
          <SectionHeader title={projectsHeader} />
          <WallSkeleton className={WALL} />
        </section>
      )}

      {displayAlbums.length > 0 && (
        <section>
          <SectionHeader title={projectsHeader} />
          <div className={WALL}>
            {displayAlbums.map((album) => (
              <AlbumTileWithArtist key={album.addressableId} album={album} onOpen={() => openAlbum(album.addressableId)} />
            ))}
          </div>
        </section>
      )}

      {showTracks && (
        <section>
          <SectionHeader
            title={trendingDelivered ? "Trending" : "Recent"}
            disclosure={status === "ready" ? trackDisclosure : null}
          />
          {status === "loading" ? (
            <WallSkeleton className={WALL} />
          ) : status === "error" || (nothing && loadError) ? (
            <EmptyState
              title="Music unavailable"
              message={loadError ?? "Couldn't load music."}
              action={{ label: "Try again", onClick: reload }}
            />
          ) : displayTracks.length === 0 ? (
            activeScene ? (
              <EmptyState title="Nothing in this scene" message="Try another scene." />
            ) : (
              <EmptyState title="No music yet" message="Releases appear here as artists publish." />
            )
          ) : (
            <div className={WALL}>
              {displayTracks.map((track, i) => (
                <StoreTrackTile
                  key={track.addressableId}
                  track={track}
                  albums={albums}
                  isCurrent={player.currentTrackId === track.addressableId}
                  isPlaying={player.isPlaying}
                  onActivate={() => playFromList(displayTracks, i)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {publicPlaylists.length > 0 && (
        <section>
          <SectionHeader title="Folders" />
          <div className={ROWS}>
            {publicPlaylists.map((pl: MusicPlaylist) => (
              <PublishedFolderRow key={pl.addressableId} playlist={pl} onOpen={openPlaylist} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StoreTrackTile({
  track,
  albums,
  isCurrent,
  isPlaying,
  onActivate,
}: {
  track: MusicTrack;
  albums: Record<string, MusicAlbum>;
  isCurrent: boolean;
  isPlaying: boolean;
  onActivate: () => void;
}) {
  const artist = useResolvedArtist(track.artist, track.artistPubkeys);
  return (
    <TrackTile
      title={track.title}
      artist={artist}
      imageUrl={getTrackImage(track, albums)}
      signal={trackSignalLabel(track, NO_ZAPS)}
      isCurrent={isCurrent}
      isPlaying={isPlaying}
      onActivate={onActivate}
    />
  );
}

function AlbumTileWithArtist({ album, onOpen }: { album: MusicAlbum; onOpen: () => void }) {
  const artist = useResolvedArtist(album.artist, album.artistPubkeys);
  return <AlbumTile title={album.title} artist={artist} imageUrl={album.imageUrl} onOpen={onOpen} />;
}
