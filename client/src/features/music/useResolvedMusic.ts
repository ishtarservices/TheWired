import { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { EVENT_KINDS } from "@/types/nostr";
import { resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import type { MusicTrack, MusicAlbum } from "@/types/music";

/**
 * Look up a music track/album by address (`kind:pubkey:identifier`) in the
 * store, auto-resolving via the backend when missing (events flow back through
 * the pipeline into musicSlice). Extracted from MusicEmbedCard so other
 * surfaces (poll options, etc.) can embed playable tracks.
 */
export function useResolvedMusic(
  kind: number,
  pubkey: string,
  identifier: string,
): {
  addressableId: string;
  track: MusicTrack | undefined;
  album: MusicAlbum | undefined;
  resolving: boolean;
} {
  const addressableId = `${kind}:${pubkey}:${identifier}`;
  const isTrack = kind === EVENT_KINDS.MUSIC_TRACK;

  const track = useAppSelector((s) =>
    isTrack ? s.music.tracks[addressableId] : undefined,
  );
  const album = useAppSelector((s) =>
    !isTrack ? s.music.albums[addressableId] : undefined,
  );

  const [resolving, setResolving] = useState(false);
  const hasData = isTrack ? !!track?.title : !!album?.title;

  useEffect(() => {
    if (hasData || resolving) return;
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
  }, [hasData, isTrack, pubkey, identifier, resolving]);

  return { addressableId, track, album, resolving };
}
