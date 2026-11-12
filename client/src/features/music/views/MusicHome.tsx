import { useMemo, useEffect, useState } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import {
  addTracks,
  addAlbums,
  setTrendingTrackIds,
  setTrendingAlbumIds,
  setExploreGenres,
  setActiveGenre,
  setActiveTag,
  setActiveScene,
  setMusicView,
} from "@/store/slices/musicSlice";
import { selectLibraryTracks, selectLibraryAlbums } from "../musicSelectors";
import { getGenres, browseMusic, browseAlbums as browseAlbumsApi } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { TrackCard } from "../TrackCard";
import { AlbumCard } from "../AlbumCard";
import { MusicGetStarted } from "../MusicGetStarted";
import { byInteraction, collectionWall, mixExplore, type ExploreItem } from "../exploreMix";
import { useIsMine } from "../sharedKey/ownership";
import { ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { useSpace } from "@/features/spaces/useSpace";
import { setLastChannel } from "@/lib/db/lastChannelCache";
import { useScenes } from "@/features/discover/useScenes";
import { sceneChips } from "@/features/discover/taxonomy";
import { FacetChip, FacetList, FacetRow } from "../Facets";
import { spaceShelf } from "../spaceMusic";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-x-5 gap-y-8";
/** Three rows on a wide window; the rest sits behind "Show all". */
const COLLECTION_PREVIEW = 18;


export function MusicHome() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const dispatch = useAppDispatch();
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const trendingTrackIds = useAppSelector((s) => s.music.discovery.trendingTrackIds);
  const trendingAlbumIds = useAppSelector((s) => s.music.discovery.trendingAlbumIds);
  const newReleaseIds = useAppSelector((s) => s.music.discovery.newReleaseIds);
  const exploreGenres = useAppSelector((s) => s.music.explore.genres);
  const playedAt = useAppSelector((s) => s.music.discovery.recentlyPlayedAt);
  const savedStamps = useAppSelector((s) => s.music.librarySync.record.saved);
  const tracksByAlbum = useAppSelector((s) => s.music.tracksByAlbum);
  const isMine = useIsMine();
  const spaces = useAppSelector((s) => s.spaces.list);
  const spaceChannels = useAppSelector((s) => s.spaces.channels);
  const { selectSpace } = useSpace();
  const scenes = useScenes();
  const muteList = useAppSelector((s) => s.identity.muteList);

  const libraryTracksSelector = useMemo(() => selectLibraryTracks(pubkey), [pubkey]);
  const libraryAlbumsSelector = useMemo(() => selectLibraryAlbums(pubkey), [pubkey]);
  const libraryTracks = useAppSelector(libraryTracksSelector);
  const libraryAlbums = useAppSelector(libraryAlbumsSelector);

  // Load genres, tags, and trending data once
  useEffect(() => {
    if (exploreGenres.length === 0) {
      getGenres()
        .then((res) => dispatch(setExploreGenres(res.data)))
        .catch((err) => console.debug("[music] Failed to load genres:", err));
    }

    // Fetch trending tracks
    if (trendingTrackIds.length === 0) {
      browseMusic({ sort: "trending", limit: 12 })
        .then((res) => {
          const parsed = res.data.tracks.map((evt: any) => parseTrackEvent(evt));
          dispatch(addTracks(parsed));
          dispatch(setTrendingTrackIds(parsed.map((t) => t.addressableId)));
          for (const evt of res.data.tracks) {
            processIncomingEvent(evt, "browse").catch(() => {});
          }
        })
        .catch((err) => console.debug("[music] Failed to load trending tracks:", err));
    }

    // Fetch trending albums
    if (trendingAlbumIds.length === 0) {
      browseAlbumsApi({ sort: "trending", limit: 8 })
        .then((res) => {
          const parsed = res.data.albums.map((evt: any) => parseAlbumEvent(evt));
          dispatch(addAlbums(parsed));
          dispatch(setTrendingAlbumIds(parsed.map((a) => a.addressableId)));
          for (const evt of res.data.albums) {
            processIncomingEvent(evt, "browse").catch(() => {});
          }
        })
        .catch((err) => console.debug("[music] Failed to load trending albums:", err));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trendingTracks = useMemo(
    () => trendingTrackIds.map((id) => tracks[id]).filter(Boolean),
    [trendingTrackIds, tracks],
  );

  const trendingAlbums = useMemo(
    () => trendingAlbumIds.map((id) => albums[id]).filter(Boolean),
    [trendingAlbumIds, albums],
  );

  const newReleases = useMemo(
    () => newReleaseIds.map((id) => albums[id]).filter(Boolean),
    [newReleaseIds, albums],
  );

  // The viewer's own collection: what they uploaded or saved, each release
  // once, ordered by when they last touched it (played, saved, or published).
  const collection = useMemo(
    () =>
      byInteraction(collectionWall(libraryAlbums, libraryTracks, albums), {
        playedAt,
        savedStamps,
        isMine,
        tracksOf: (album) => (album.trackRefs.length > 0 ? album.trackRefs : tracksByAlbum[album.addressableId] ?? []),
      }),
    [libraryAlbums, libraryTracks, albums, playedAt, savedStamps, isMine, tracksByAlbum],
  );
  // What's moving elsewhere, minus anything already in the collection.
  const trending = useMemo(() => {
    const mine = new Set(collection.map((i) => i.id));
    const seen = new Set<string>();
    const projects = [...trendingAlbums, ...newReleases].filter((a) => {
      if (seen.has(a.addressableId)) return false;
      seen.add(a.addressableId);
      return true;
    });
    return mixExplore(projects, trendingTracks).filter((i) => !mine.has(i.id));
  }, [collection, trendingAlbums, newReleases, trendingTracks]);

  // Space-only releases from the spaces this account is in. They arrive in
  // the background (groupSubscriptions.backfillSpaceMusic); nothing is fetched
  // here.
  const fromSpaces = useMemo(() => {
    const mutedSet = new Set<string>();
    for (const m of muteList) if (m.type === "pubkey") mutedSet.add(m.value);
    return spaceShelf(albums, tracks, {
      joined: new Set(spaces.map((s) => s.id)),
      isMine,
      muted: mutedSet,
      exclude: new Set(collection.map((i) => i.id)),
    });
  }, [albums, tracks, spaces, isMine, muteList, collection]);

  const [showAll, setShowAll] = useState(false);

  // Browse is folded by default; the choice is remembered per account.
  const browseKey = pubkey ? `${pubkey}:music_home_browse_open` : "music_home_browse_open";
  const [browseOpen, setBrowseOpen] = useState(() => {
    try {
      return localStorage.getItem(browseKey) === "true";
    } catch {
      return false;
    }
  });
  const toggleBrowse = () =>
    setBrowseOpen((open) => {
      try {
        localStorage.setItem(browseKey, String(!open));
      } catch {
        /* private mode: the choice just isn't remembered */
      }
      return !open;
    });

  // Joined spaces that have a music channel, with how many space-only
  // releases this device already knows about (0 until the channel is visited).
  const musicSpaces = useMemo(() => {
    if (!browseOpen) return [];
    const counts = new Map<string, number>();
    const bump = (item: { visibility: string; spaceIds?: string[] }) => {
      if (item.visibility !== "space") return;
      for (const id of item.spaceIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    };
    const spaceProjects = new Set<string>();
    for (const a of Object.values(albums)) {
      bump(a);
      if (a.visibility === "space") spaceProjects.add(a.addressableId);
    }
    for (const t of Object.values(tracks)) {
      // A track inside a counted project is that project, not another release.
      if (!t.albumRef || !spaceProjects.has(t.albumRef)) bump(t);
    }
    return spaces.flatMap((space) => {
      const channel = spaceChannels[space.id]?.find((c) => c.type === "music");
      return channel ? [{ space, channelId: channel.id, count: counts.get(space.id) ?? 0 }] : [];
    });
  }, [browseOpen, spaces, spaceChannels, albums, tracks]);

  const sceneOptions = useMemo(
    () => (browseOpen ? sceneChips(scenes, { genres: exploreGenres.map((g) => g.genre) }) : []),
    [browseOpen, scenes, exploreGenres],
  );

  // Nothing of the viewer's own (uploaded or saved): the home either IS the
  // invitation, or carries it as a strip above the trending content.
  const libraryEmpty = collection.length === 0;

  if (libraryEmpty && trending.length === 0 && fromSpaces.length === 0) {
    return <MusicGetStarted />;
  }

  const shownCollection = showAll ? collection : collection.slice(0, COLLECTION_PREVIEW);
  const collectionTrackIds = collection.filter((i) => i.kind === "track").map((i) => i.id);
  const trendingTrackQueue = trending.filter((i) => i.kind === "track").map((i) => i.id);
  const spaceTrackQueue = fromSpaces.filter((i) => i.kind === "track").map((i) => i.id);

  const handleGenreClick = (genre: string) => {
    dispatch(setActiveGenre(genre));
    dispatch(setActiveTag(null));
    dispatch(setActiveScene(null));
    dispatch(setMusicView("explore"));
  };

  const handleSceneClick = (slug: string) => {
    dispatch(setActiveScene(slug));
    dispatch(setActiveGenre(null));
    dispatch(setActiveTag(null));
    dispatch(setMusicView("explore"));
  };

  /** Space-only releases are fetched and gated by the space's own music
   *  channel, so Home links there rather than loading them itself. */
  const openSpaceMusic = (spaceId: string, channelId: string) => {
    setLastChannel(spaceId, channelId);
    dispatch(setSidebarMode("spaces"));
    selectSpace(spaceId);
  };

  const hasBrowse = musicSpaces.length > 0 || sceneOptions.length > 0 || exploreGenres.length > 0;

  const renderItem = (item: ExploreItem, queue: string[]) =>
    item.kind === "project" ? (
      <AlbumCard album={item.album} />
    ) : (
      <TrackCard track={item.track} queueTracks={queue} queueIndex={queue.indexOf(item.id)} />
    );

  return (
    <div className={`flex-1 overflow-y-auto px-8 py-7 ${scrollPaddingClass}`}>
      {libraryEmpty && <MusicGetStarted variant="banner" />}

      {/* Your collection: one wall, like Explore */}
      {collection.length > 0 && (
        <section className="mb-10">
          <header className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-heading">Your collection</h1>
            <div className="flex items-center gap-4 text-[13px]">
              <button
                onClick={() => dispatch(setMusicView("albums"))}
                className="rounded-sm text-muted transition-colors hover:text-heading"
              >
                Projects
              </button>
              <button
                onClick={() => dispatch(setMusicView("songs"))}
                className="rounded-sm text-muted transition-colors hover:text-heading"
              >
                Songs
              </button>
            </div>
            <span className="readout ml-auto text-[11px] uppercase tracking-wider text-muted">
              {collection.length} release{collection.length !== 1 ? "s" : ""}
            </span>
          </header>
          <div className={GRID}>
            {shownCollection.map((item) => (
              <div key={item.id}>{renderItem(item, collectionTrackIds)}</div>
            ))}
          </div>
          {collection.length > COLLECTION_PREVIEW && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-6 rounded-lg px-2.5 py-1.5 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
            >
              {showAll ? "Show less" : `Show all ${collection.length}`}
            </button>
          )}
        </section>
      )}

      {/* Space-only releases from the viewer's spaces: one short row */}
      {fromSpaces.length > 0 && (
        <section className="mb-10">
          <div className={`mb-4 flex items-baseline gap-4 ${libraryEmpty ? "" : "border-t border-border-light pt-6"}`}>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-heading">From your spaces</h2>
            <span className="text-[13px] text-muted">Only members can hear these</span>
          </div>
          <div className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-3 pt-1">
            {fromSpaces.map((item) => (
              <div key={item.id} className="w-40 shrink-0">
                {renderItem(item, spaceTrackQueue)}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trending: the whole page for a new account, one short row otherwise */}
      {trending.length > 0 && (
        <section className="mb-10">
          {libraryEmpty ? (
            <h1 className="mb-6 text-2xl font-semibold tracking-[-0.02em] text-heading">Trending</h1>
          ) : (
            <div className="mb-4 flex items-baseline gap-4 border-t border-border-light pt-6">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-heading">Trending</h2>
              <button
                onClick={() => dispatch(setMusicView("explore"))}
                className="rounded-sm text-[13px] text-muted transition-colors hover:text-heading"
              >
                Explore
              </button>
            </div>
          )}
          {libraryEmpty ? (
            <div className={GRID}>
              {trending.map((item) => (
                <div key={item.id}>{renderItem(item, trendingTrackQueue)}</div>
              ))}
            </div>
          ) : (
            <div className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-3 pt-1">
              {trending.slice(0, 12).map((item) => (
                <div key={item.id} className="w-40 shrink-0">
                  {renderItem(item, trendingTrackQueue)}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Browse: ways in, not content. Folded away by default. */}
      {hasBrowse && (
        <section className="border-t border-border-light pt-3">
          <button
            onClick={toggleBrowse}
            aria-expanded={browseOpen}
            aria-controls="music-home-browse"
            className="group -ml-1 flex h-7 items-center gap-1.5 rounded-md px-1"
          >
            <ChevronRight
              size={10}
              className={`text-muted transition-transform duration-150 ${browseOpen ? "rotate-90" : ""}`}
            />
            <span className="label-caps transition-colors group-hover:text-heading">Browse</span>
          </button>

          {browseOpen && (
            <FacetList id="music-home-browse" className="animate-fade-in mt-2">
              {/* Spaces with a music channel: where space-only releases live */}
              {musicSpaces.length > 0 && (
                <FacetRow label="Space">
                  {musicSpaces.map(({ space, channelId, count }) => (
                    <FacetChip
                      key={space.id}
                      onClick={() => openSpaceMusic(space.id, channelId)}
                      title={`Open the music channel in ${space.name}`}
                      leading={<Avatar src={space.picture} alt="" size="xs" />}
                      count={count > 0 ? count : undefined}
                    >
                      {space.name}
                    </FacetChip>
                  ))}
                </FacetRow>
              )}
              {sceneOptions.length > 0 && (
                <FacetRow label="Scene">
                  {sceneOptions.map((sc) => (
                    <FacetChip key={sc.value} onClick={() => handleSceneClick(sc.value)}>
                      {sc.label}
                    </FacetChip>
                  ))}
                </FacetRow>
              )}
              {exploreGenres.length > 0 && (
                <FacetRow label="Genre">
                  {exploreGenres.slice(0, 14).map((g) => (
                    <FacetChip key={g.genre} onClick={() => handleGenreClick(g.genre)} count={g.count}>
                      {g.genre}
                    </FacetChip>
                  ))}
                </FacetRow>
              )}
            </FacetList>
          )}
        </section>
      )}
    </div>
  );
}
