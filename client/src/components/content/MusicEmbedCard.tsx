import { lazy, Suspense, useCallback, useContext, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "react-redux";
import { AudioLines, Disc3, FolderOpen, Loader2, Lock, MoreHorizontal, Music, Pause, Play } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import type { RootState } from "@/store";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { useResolvedMusic } from "@/features/music/useResolvedMusic";
import { getTrackImage } from "@/features/music/trackImage";
import { useResolvedArtist, resolveArtistDetailTarget } from "@/features/music/useResolvedArtist";
import { RequestAccessButton } from "@/features/music/RequestAccessButton";
import { resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { EVENT_KINDS } from "@/types/nostr";
import type { MusicAlbum, MusicPlaylist, MusicTrack, MusicView, ProjectType } from "@/types/music";
import { EmbedDepthContext } from "./embedDepth";
import { coverKey, MusicEmbedShapeContext, NoteMediaContext } from "./musicEmbedContext";

const LazyMusicEmbedMenu = lazy(() =>
  import("./MusicEmbedMenu").then((m) => ({ default: m.MusicEmbedMenu })),
);

interface MusicEmbedCardProps {
  kind: number;
  pubkey: string;
  identifier: string;
  /**
   * Force a shape. By default: `compact` one embed deep, the `poster` when the
   * host asks for it (chat) and the release can be one, else the full row.
   */
  variant?: "row" | "compact" | "poster";
}

const PROJECT_LABEL: Record<ProjectType, string> = {
  album: "Album",
  ep: "EP",
  demo: "Demo",
  mix: "Mix",
  other: "Project",
};

/** `m:ss` for a track length in seconds; empty when unknown. */
export function formatTrackDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The "kind line" under a release's title: what it is, and how long. */
export function musicCaption(item: { track?: MusicTrack; album?: MusicAlbum; playlist?: MusicPlaylist }): string {
  if (item.track) return ["Track", formatTrackDuration(item.track.duration)].filter(Boolean).join(" · ");
  if (item.album) {
    const label = PROJECT_LABEL[item.album.projectType] ?? "Project";
    return item.album.trackRefs.length > 0 ? `${label} · ${plural(item.album.trackRefs.length, "track")}` : label;
  }
  if (item.playlist) return `Folder · ${plural(item.playlist.trackRefs.length, "track")}`;
  return "";
}

/**
 * A shared track, project or folder (`nostr:naddr`) wherever a note, a chat
 * message or a DM names one. Three shapes:
 *  - row: cover · title · artist · kind line · ▶ · ⋯ (the release's own panel)
 *  - compact: one embed deep — small cover, title and kind line
 *  - poster: chat/DM, a public track or project drawn as its cover with the
 *    title and ▶ on it
 * The cover drops out when the surrounding note already shows that picture.
 */
export function MusicEmbedCard({ kind, pubkey, identifier, variant }: MusicEmbedCardProps) {
  const depth = useContext(EmbedDepthContext);
  const shape = useContext(MusicEmbedShapeContext);
  const notePictures = useContext(NoteMediaContext);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const store = useStore<RootState>();
  const signedIn = useAppSelector((s) => !!s.identity.pubkey);

  const { addressableId, track, album, playlist, resolving, unavailable } = useResolvedMusic(kind, pubkey, identifier);
  const albums = useAppSelector((s) => s.music.albums);
  const { play, playQueue, togglePlay, player } = useAudioPlayer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadingTracks, setLoadingTracks] = useState(false);

  const type = kind === EVENT_KINDS.MUSIC_TRACK ? "track" : kind === EVENT_KINDS.MUSIC_PLAYLIST ? "playlist" : "album";
  const item = track ?? album ?? playlist;
  const trackRefs = album?.trackRefs ?? playlist?.trackRefs;
  const image = track ? getTrackImage(track, albums) : (album?.imageUrl ?? playlist?.imageUrl);
  const rawArtist = track?.artist ?? album?.artist ?? "";
  const artistPubkeys = track?.artistPubkeys ?? album?.artistPubkeys;
  const artist = useResolvedArtist(rawArtist, artistPubkeys);

  const isCurrent = track
    ? player.currentTrackId === addressableId
    : !!player.currentTrackId && !!trackRefs?.includes(player.currentTrackId);
  const isPlaying = isCurrent && player.isPlaying;
  const playable = track ? track.variants.length > 0 : (trackRefs?.length ?? 0) > 0;

  const openView = useCallback(
    (view: MusicView, id: string) => {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveDetailId({ view, id }));
      // Root so MainContent renders (the center panel may be on /profile or /dm).
      navigate("/");
    },
    [dispatch, navigate],
  );

  const open = useCallback(() => {
    if (type === "album") openView("album-detail", addressableId);
    else if (type === "playlist") openView("published-folder", addressableId);
    else if (track?.albumRef) openView("album-detail", track.albumRef);
    else setMenuOpen(true);
  }, [type, addressableId, track?.albumRef, openView]);

  const playRelease = useCallback(async () => {
    if (track) {
      if (isCurrent) togglePlay();
      else play(track.addressableId);
      return;
    }
    if (isCurrent) {
      togglePlay();
      return;
    }
    const refs = trackRefs ?? [];
    const playableIds = () => {
      const tracks = store.getState().music.tracks;
      return refs.filter((id) => (tracks[id]?.variants.length ?? 0) > 0);
    };
    let ids = playableIds();
    if (ids.length === 0 && type === "album") {
      // The project is known but its tracks never reached this device.
      setLoadingTracks(true);
      try {
        const res = await resolveMusic("album", pubkey, identifier, { auth: signedIn });
        const data = res.data as { tracks?: unknown[] };
        for (const ev of data.tracks ?? []) await processIncomingEvent(ev, "resolve");
      } catch {
        // Fall through to opening the project.
      } finally {
        setLoadingTracks(false);
      }
      ids = playableIds();
    }
    if (ids.length > 0) playQueue(ids, 0);
    else open();
  }, [track, isCurrent, togglePlay, play, trackRefs, store, type, pubkey, identifier, signedIn, playQueue, open]);

  const openArtist = (e: MouseEvent) => {
    e.stopPropagation();
    const target = resolveArtistDetailTarget(rawArtist, artistPubkeys);
    if (target) openView(target.view, target.id);
  };

  const compact = variant === "compact" || (variant === undefined && depth >= 1);
  const canPoster =
    !!item &&
    type !== "playlist" &&
    item.visibility === "public" &&
    (track ? track.variants.length > 0 : true);
  const poster = variant === "poster" || (variant === undefined && !compact && shape === "poster" && canPoster);
  const coverShownAbove = !!image && notePictures.includes(coverKey(image));

  // Clicks inside a card never reach the note around it (which would open the thread).
  const primary = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    if (type === "track") void playRelease();
    else open();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      primary(e);
    }
  };
  const playButton = (e: MouseEvent) => {
    e.stopPropagation();
    void playRelease();
  };
  const moreButton = (e: MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(true);
  };

  const menu = menuOpen && (track || album) && (
    <Suspense fallback={null}>
      <LazyMusicEmbedMenu track={track} album={album} onClose={() => setMenuOpen(false)} />
    </Suspense>
  );

  // ── Not resolved (yet) ──
  if (!item?.title) {
    const label = type === "playlist" ? "Folder" : type === "album" ? "Project" : "Track";
    return (
      <div className={`${compact ? "mt-1.5 max-w-sm" : "mt-2 max-w-md"} flex w-full flex-col items-start gap-1`}>
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            if (!resolving) open();
          }}
          onKeyDown={onKey}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border card-glass px-3 py-2 text-left transition-colors hover:border-faint"
        >
          <div className={`flex ${compact ? "h-9 w-9" : "h-12 w-12"} shrink-0 items-center justify-center rounded-lg bg-card`}>
            {resolving ? (
              <Loader2 size={16} className="animate-spin text-muted" />
            ) : unavailable ? (
              <Lock size={15} className="text-muted" />
            ) : (
              <Music size={16} className="text-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-heading">
              {resolving ? "Loading…" : unavailable ? `${label} unavailable` : identifier || label}
            </p>
            <p className="truncate text-xs text-muted">
              {unavailable ? "It may be private, or live on relays you don't read" : label}
            </p>
          </div>
        </div>
        {unavailable && type !== "playlist" && <RequestAccessButton targetRef={addressableId} className="pl-1" />}
      </div>
    );
  }

  const title = item.title;
  const caption = musicCaption({ track, album, playlist });
  const membersOnly = item.visibility === "space";
  const PlayIcon = isPlaying ? Pause : Play;

  // ── Poster (chat / DM) ──
  if (poster) {
    return (
      <>
        <div
          role="button"
          tabIndex={0}
          onClick={primary}
          onKeyDown={onKey}
          className="group/poster relative mt-2 block h-[220px] w-[220px] cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left"
        >
          {image ? (
            <img src={image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 via-card to-surface">
              <Disc3 size={56} className="text-heading/30" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-black/80 to-transparent" />
          <button
            type="button"
            onClick={moreButton}
            className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white/80 opacity-0 transition-opacity hover:bg-black/70 hover:text-white group-hover/poster:opacity-100 focus:opacity-100"
            title="More"
          >
            <MoreHorizontal size={14} />
          </button>
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 p-3">
            <div className="min-w-0 flex-1">
              <p className={`line-clamp-2 text-sm font-semibold leading-snug ${isCurrent ? "text-primary-soft" : "text-white"}`}>
                {title}
              </p>
              <p className="mt-0.5 truncate text-[11px] tabular-nums text-white/75">
                {[artist, caption].filter(Boolean).join(" · ")}
              </p>
            </div>
            {playable && (
              <button
                type="button"
                onClick={playButton}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
                title={isPlaying ? "Pause" : "Play"}
              >
                {loadingTracks ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <PlayIcon size={15} fill="currentColor" className={isPlaying ? "" : "ml-0.5"} />
                )}
              </button>
            )}
          </div>
        </div>
        {menu}
      </>
    );
  }

  const cover = (size: string, iconSize: number) =>
    image && !coverShownAbove ? (
      <img src={image} alt="" loading="lazy" className={`${size} shrink-0 rounded-lg object-cover`} />
    ) : coverShownAbove ? null : (
      <div className={`flex ${size} shrink-0 items-center justify-center rounded-lg bg-card`}>
        {type === "playlist" ? (
          <FolderOpen size={iconSize} className="text-muted" />
        ) : (
          <Disc3 size={iconSize} className="text-muted" />
        )}
      </div>
    );

  // ── Compact (inside a quoted note) ──
  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={primary}
        onKeyDown={onKey}
        className={`mt-1.5 flex w-full max-w-sm cursor-pointer items-center gap-2.5 rounded-lg border bg-surface px-2.5 py-1.5 text-left transition-colors ${
          isCurrent ? "border-primary/40" : "border-border hover:border-faint"
        }`}
      >
        {cover("h-9 w-9", 15)}
        <div className="min-w-0 flex-1">
          <p className={`truncate text-xs font-medium ${isCurrent ? "text-primary" : "text-heading"}`}>{title}</p>
          <p className="truncate text-[11px] tabular-nums text-muted">
            {[type === "playlist" ? "" : artist, caption].filter(Boolean).join(" · ")}
          </p>
        </div>
        {isPlaying ? (
          <AudioLines size={14} className="shrink-0 text-primary" />
        ) : (
          type === "track" && playable && <Play size={12} className="shrink-0 text-muted" />
        )}
      </div>
    );
  }

  // ── Row ──
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={primary}
        onKeyDown={onKey}
        className={`group/music mt-2 flex w-full max-w-md cursor-pointer items-center gap-3 rounded-xl border card-glass px-3 py-2.5 text-left transition-colors ${
          isCurrent ? "border-primary/40" : "border-border hover:border-faint"
        }`}
      >
        {cover("h-14 w-14", 20)}
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-semibold ${isCurrent ? "text-primary" : "text-heading"}`}>{title}</p>
          {type !== "playlist" && artist && (
            <button
              type="button"
              onClick={openArtist}
              className="block max-w-full truncate text-left text-xs text-soft hover:text-heading hover:underline"
            >
              {artist}
            </button>
          )}
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] tabular-nums text-muted">
            {isPlaying && <AudioLines size={12} className="shrink-0 text-primary" />}
            {membersOnly && <Lock size={10} className="shrink-0" />}
            <span className="truncate">{membersOnly ? `${caption} · Members only` : caption}</span>
          </p>
        </div>
        {(track || album) && (
          <button
            type="button"
            onClick={moreButton}
            className="shrink-0 rounded-lg p-1.5 text-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-heading group-hover/music:opacity-100 focus:opacity-100"
            title="More"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
        {playable && (
          <button
            type="button"
            onClick={playButton}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
              isPlaying
                ? "border border-primary/40 bg-white/10 text-primary"
                : "bg-primary text-white hover:opacity-90"
            }`}
            title={isPlaying ? "Pause" : "Play"}
          >
            {loadingTracks ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PlayIcon size={14} fill="currentColor" className={isPlaying ? "" : "ml-0.5"} />
            )}
          </button>
        )}
      </div>
      {menu}
    </>
  );
}
