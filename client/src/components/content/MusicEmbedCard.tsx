import { useMemo, useState, useEffect, useCallback } from "react";
import { Play, Pause, Disc3, Loader2, Music } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { getTrackImage } from "@/features/music/trackImage";
import { resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";

interface MusicEmbedCardProps {
  kind: number;
  pubkey: string;
  identifier: string;
}

export function MusicEmbedCard({ kind, pubkey, identifier }: MusicEmbedCardProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const addressableId = `${kind}:${pubkey}:${identifier}`;
  const isTrack = kind === 31683;

  const track = useAppSelector((s) =>
    isTrack ? s.music.tracks[addressableId] : undefined,
  );
  const album = useAppSelector((s) =>
    !isTrack ? s.music.albums[addressableId] : undefined,
  );
  const albums = useAppSelector((s) => s.music.albums);
  const { play, togglePlay, player } = useAudioPlayer();

  const isCurrent = isTrack && player.currentTrackId === addressableId;
  const isPlaying = isCurrent && player.isPlaying;

  const image = useMemo(() => {
    if (isTrack && track) return getTrackImage(track, albums);
    if (!isTrack && album) return album.imageUrl;
    return undefined;
  }, [isTrack, track, album, albums]);

  const title = isTrack ? track?.title : album?.title;
  const artist = isTrack ? track?.artist : album?.artist;

  // ── Auto-resolve when data isn't in store ──
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (title || resolving) return;
    let cancelled = false;
    const type = isTrack ? "track" : "album";

    setResolving(true);
    resolveMusic(type, pubkey, identifier)
      .then(async (result) => {
        if (cancelled) return;
        const data = result.data;
        await processIncomingEvent((data as { event: unknown }).event, "resolve");
        if ("tracks" in data && Array.isArray(data.tracks)) {
          for (const trackEvent of data.tracks) {
            await processIncomingEvent(trackEvent, "resolve");
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setResolving(false); });

    return () => { cancelled = true; };
  }, [title, isTrack, pubkey, identifier, resolving]);

  // ── Navigate handler (used for both resolved and unresolved states) ──
  const handleNavigate = useCallback(() => {
    if (!isTrack) {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveDetailId({ view: "album-detail", id: addressableId }));
      // Navigate to root so MainContent renders (center panel may be on /profile or /dm)
      navigate("/");
    }
  }, [isTrack, addressableId, dispatch, navigate]);

  // ── Placeholder state (data not yet in store) ──
  if (!title) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleNavigate();
        }}
        className="mt-1 inline-flex items-center gap-3 rounded-xl border border-border card-glass px-3 py-2 text-left transition-all hover:border-border-light hover-lift max-w-xs cursor-pointer"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card">
          {resolving ? (
            <Loader2 size={16} className="text-muted animate-spin" />
          ) : (
            <Music size={16} className="text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-heading">
            {resolving ? "Loading..." : identifier || "Music"}
          </p>
          <p className="truncate text-xs text-soft">
            {isTrack ? "Track" : "Album"}
          </p>
        </div>
      </button>
    );
  }

  // ── Resolved state ──
  const handleClick = () => {
    if (isTrack && track) {
      if (isCurrent) {
        togglePlay();
      } else {
        play(track.addressableId);
      }
    } else if (!isTrack) {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveDetailId({ view: "album-detail", id: addressableId }));
      navigate("/");
    }
  };

  const PlayPauseIcon = isPlaying ? Pause : Play;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleClick();
      }}
      className={`mt-1 inline-flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all hover-lift max-w-xs ${
        isCurrent
          ? "border-primary/40 card-glass"
          : "border-border card-glass hover:border-border-light"
      }`}
    >
      {image ? (
        <img
          src={image}
          alt={title}
          className="h-10 w-10 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card">
          <Disc3 size={18} className="text-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${isCurrent ? "text-primary" : "text-heading"}`}>
          {title}
        </p>
        <p className="truncate text-xs text-soft">{artist}</p>
      </div>
      {isTrack && (
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
          isPlaying
            ? "bg-white/10 border border-primary/40"
            : "bg-gradient-to-r from-primary to-primary-soft"
        }`}>
          <PlayPauseIcon
            size={12}
            fill={isPlaying ? "currentColor" : "white"}
            className={isPlaying ? "text-primary" : "ml-0.5 text-white"}
          />
        </div>
      )}
    </button>
  );
}
