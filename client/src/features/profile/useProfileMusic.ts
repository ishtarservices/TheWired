import { useState, useEffect, useRef, useMemo } from "react";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "@/lib/nostr/constants";
import { useAppSelector } from "@/store/hooks";
import { EVENT_KINDS } from "@/types/nostr";
import { selectProfileTracks, selectProfileAlbums } from "@/features/music/musicSelectors";
import { selectMyCollaborations } from "@/features/music/musicSelectors";

/**
 * Ensures music tracks and albums for a given pubkey are fetched from relays
 * and available in the Redux music store.
 *
 * Uses subscriptionManager so events flow through the standard pipeline
 * (dedup → validate → verify → dispatch into musicSlice).
 */
export function useProfileMusic(pubkey: string) {
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef<string | null>(null);

  // Subscribe for this user's tracks and albums
  useEffect(() => {
    if (fetchedRef.current === pubkey) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const subId = subscriptionManager.subscribe({
      filters: [
        {
          kinds: [EVENT_KINDS.MUSIC_TRACK, EVENT_KINDS.MUSIC_ALBUM],
          authors: [pubkey],
          limit: 200,
        },
      ],
      relayUrls: PROFILE_RELAYS,
      onEOSE: () => {
        setLoading(false);
        fetchedRef.current = pubkey;
        subscriptionManager.close(subId);
      },
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [pubkey]);

  const selectTracks = useMemo(() => selectProfileTracks(pubkey), [pubkey]);
  const selectAlbums = useMemo(() => selectProfileAlbums(pubkey), [pubkey]);
  const selectCollabs = useMemo(() => selectMyCollaborations(pubkey), [pubkey]);

  const tracks = useAppSelector(selectTracks);
  const albums = useAppSelector(selectAlbums);
  const collaborations = useAppSelector(selectCollabs);

  return { tracks, albums, collaborations, loading };
}
