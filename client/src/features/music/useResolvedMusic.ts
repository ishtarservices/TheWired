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
 *
 * The anonymous resolve is tried first; when it misses and the viewer is
 * signed in, one NIP-98 retry lets a granted viewer (or space member) resolve
 * a private release. `unavailable` = both attempts finished without data, so
 * the caller can offer a listen request. A failed address is not retried
 * until it changes.
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
  unavailable: boolean;
} {
  const addressableId = `${kind}:${pubkey}:${identifier}`;
  const isTrack = kind === EVENT_KINDS.MUSIC_TRACK;
  const signedIn = useAppSelector((s) => !!s.identity.pubkey);

  const track = useAppSelector((s) =>
    isTrack ? s.music.tracks[addressableId] : undefined,
  );
  const album = useAppSelector((s) =>
    !isTrack ? s.music.albums[addressableId] : undefined,
  );

  const [resolving, setResolving] = useState(false);
  // Keyed by address + sign-in state: signing in earns one authenticated retry.
  const attemptKey = `${addressableId}|${signedIn ? "auth" : "anon"}`;
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const hasData = isTrack ? !!track?.title : !!album?.title;
  const failed = failedFor === attemptKey;

  useEffect(() => {
    if (hasData || failed) return;
    const type = isTrack ? "track" : "album";

    // `resolving` must not be an effect dependency: flipping it would run the
    // cleanup and drop the in-flight result.
    setResolving(true);
    resolveMusic(type, pubkey, identifier)
      .catch((err) => {
        if (!signedIn) throw err;
        return resolveMusic(type, pubkey, identifier, { auth: true });
      })
      .then(async (result) => {
        const data = result.data;
        await processIncomingEvent((data as { event: unknown }).event, "resolve");
        if ("tracks" in data && Array.isArray(data.tracks)) {
          for (const trackEvent of data.tracks) {
            await processIncomingEvent(trackEvent, "resolve");
          }
        }
      })
      .catch(() => setFailedFor(attemptKey))
      .finally(() => setResolving(false));
  }, [hasData, failed, isTrack, pubkey, identifier, signedIn, attemptKey]);

  return { addressableId, track, album, resolving, unavailable: failed && !hasData && !resolving };
}
