import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Music, SearchX } from "lucide-react";
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
import { api } from "@/lib/api/client";
import { browseAlbums, browseMusic, getGenres, resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { EVENT_KINDS, type NostrEvent } from "@/types/nostr";
import type { MusicAlbum, MusicPlaylist, MusicTrack } from "@/types/music";
import { parseTrackEvent } from "@/features/music/trackParser";
import { parseAlbumEvent } from "@/features/music/albumParser";
import { getTrackImage } from "@/features/music/trackImage";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { useResolvedArtist } from "@/features/music/useResolvedArtist";
import type { MusicSearchHit } from "@/features/music/useMusicSearch";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { ChipRow, type ChipOption } from "./components/ChipRow";
import { SectionHeader } from "./components/SectionHeader";
import { RailSkeleton, RowSkeleton } from "./components/Skeletons";
import { TrackRow } from "./components/TrackRow";
import { AlbumTile } from "./components/AlbumTile";
import { PlaylistRow } from "./components/PlaylistRow";
import { formatAge, rankTracks, sortDisclosure, trackSignalLabel } from "./ranking";
import { matchesScene, sceneBySlug, sceneChips } from "./taxonomy";
import { useScenes } from "./useScenes";

const DEBOUNCE_MS = 300;
const TRACK_LIMIT = 30;
const ALBUM_LIMIT = 12;
const PLAYLIST_LIMIT = 30;
const GENRE_CAP = 12;
const ONE_SHOT_TIMEOUT_MS = 6000;
const RELAY_RETRY_MS = 3000;

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
 * Music discovery: albums · playlists · genres · a ranked track list that is
 * headed "Trending" only when trending actually delivered. With a query of ≥2
 * characters it is search instead.
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
      // instead, and label the rails as recent.
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

  const publicStoreTracks = useMemo(
    () =>
      source === "relay"
        ? Object.values(tracks)
            .filter((t) => t.visibility === "public")
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, TRACK_LIMIT)
        : [],
    [source, tracks],
  );
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
        .filter((p) => p.visibility === "public" && p.trackRefs.length > 0)
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
    (payload: { view: "album-detail" | "playlist-detail"; id: string }) => {
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
      enterMusic({ view: "playlist-detail", id: playlistId });
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
      <div className={cn("@container grid grid-cols-1 gap-x-6 gap-y-1 @3xl:grid-cols-2", scrollPaddingClass)}>
        {searchResults === null ? (
          <RowSkeleton count={4} />
        ) : hits.length === 0 ? (
          <EmptyState
            title={searchError ? "Search unavailable" : "No results"}
            message={searchError ?? `Nothing matched “${trimmed}”.`}
          />
        ) : (
          hits.map(({ hit, kind }) => (
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
          ))
        )}
      </div>
    );
  }

  // ── Render: discovery ────────────────────────────────────────────────
  const albumsHeader = source === "relay" ? "Recent albums" : "Albums";
  const nothing =
    status === "ready" &&
    displayTracks.length === 0 &&
    displayAlbums.length === 0 &&
    publicPlaylists.length === 0;

  // Scenes filter albums and tracks alike, so the chips ride the first
  // section header instead of floating in a row of their own.
  const sceneRow =
    sceneOptions.length > 1 ? (
      <ChipRow options={sceneOptions} value={scene} onSelect={setScene} label="Scenes" />
    ) : null;
  const firstSection =
    status === "loading" || displayAlbums.length > 0
      ? "albums"
      : publicPlaylists.length > 0
        ? "playlists"
        : "tracks";

  return (
    <div className={cn("@container space-y-6", scrollPaddingClass)}>
      {status === "loading" && (
        <section>
          <SectionHeader title={albumsHeader} right={sceneRow} />
          <RailSkeleton />
        </section>
      )}

      {displayAlbums.length > 0 && (
        <section>
          <SectionHeader title={albumsHeader} right={firstSection === "albums" ? sceneRow : null} />
          <div className="flex gap-3 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {displayAlbums.map((album) => (
              <AlbumTileWithArtist key={album.addressableId} album={album} onOpen={() => openAlbum(album.addressableId)} />
            ))}
          </div>
        </section>
      )}

      {(publicPlaylists.length > 0 || genreList.length > 0) && (
        <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-[3fr_2fr]">
          {publicPlaylists.length > 0 && (
            <section>
              <SectionHeader title="Playlists" right={firstSection === "playlists" ? sceneRow : null} />
              <div className="space-y-1">
                {publicPlaylists.map((pl: MusicPlaylist) => (
                  <PlaylistRow key={pl.addressableId} playlist={pl} onOpen={openPlaylist} />
                ))}
              </div>
            </section>
          )}
          {genreList.length > 0 && (
            <section>
              <SectionHeader title="Genres" />
              <ChipRow
                options={genreList.map((g) => ({ value: g.genre, label: g.genre, count: g.count }))}
                value={null}
                onSelect={openGenre}
                label="Genres"
              />
            </section>
          )}
        </div>
      )}

      <section>
        <SectionHeader
          title={trendingDelivered ? "Trending" : "Recent"}
          disclosure={status === "ready" ? trackDisclosure : null}
          right={firstSection === "tracks" ? sceneRow : null}
        />
        {status === "loading" ? (
          <RowSkeleton />
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
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 @3xl:grid-cols-2">
            {displayTracks.map((track, i) => (
              <StoreTrackRow
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
    </div>
  );
}

function StoreTrackRow({
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
    <TrackRow
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

function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  const Icon = action ? Music : SearchX;
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon size={24} className="mb-2 text-muted opacity-30" />
      <p className="text-xs font-medium text-heading">{title}</p>
      <p className="mt-1 text-xs text-faint">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:border-primary/40 hover:text-primary"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
