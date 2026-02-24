import { useEffect, useState, useCallback } from "react";
import { relayManager } from "../../lib/nostr/relayManager";
import { buildFollowersFilter } from "../../lib/nostr/filterBuilder";

export function useFollowData(pubkey: string) {
  const [following, setFollowing] = useState<string[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const reset = useCallback(() => {
    setFollowing([]);
    setFollowers([]);
    setLoading(true);
  }, []);

  useEffect(() => {
    reset();

    let cancelled = false;
    let eoseCount = 0;
    const checkDone = () => {
      eoseCount++;
      if (eoseCount >= 2 && !cancelled) setLoading(false);
    };

    // Following: fetch this user's kind:3 event
    const followingSub = relayManager.subscribe({
      filters: [{ kinds: [3], authors: [pubkey], limit: 1 }],
      onEvent: (event) => {
        if (cancelled) return;
        const pTags = event.tags
          .filter((t) => t[0] === "p" && t[1])
          .map((t) => t[1]);
        setFollowing(pTags);
      },
      onEOSE: () => checkDone(),
    });

    // Followers: kind:3 events from others that contain a p tag for this pubkey
    const seen = new Set<string>();
    const followersSub = relayManager.subscribe({
      filters: [buildFollowersFilter(pubkey)],
      onEvent: (event) => {
        if (cancelled || seen.has(event.pubkey)) return;
        seen.add(event.pubkey);
        setFollowers((prev) => [...prev, event.pubkey]);
      },
      onEOSE: () => checkDone(),
    });

    return () => {
      cancelled = true;
      relayManager.closeSubscription(followingSub);
      relayManager.closeSubscription(followersSub);
    };
  }, [pubkey, reset]);

  return { following, followers, loading };
}
