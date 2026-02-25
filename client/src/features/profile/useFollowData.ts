import { useEffect, useState, useRef } from "react";
import { relayManager } from "../../lib/nostr/relayManager";
import { buildFollowersFilter } from "../../lib/nostr/filterBuilder";

type Tab = "notes" | "following" | "followers";

export function useFollowData(pubkey: string, activeTab: Tab = "notes") {
  const [following, setFollowing] = useState<string[]>([]);
  const [followers, setFollowers] = useState<string[]>([]);
  const [followingLoading, setFollowingLoading] = useState(true);
  const [followersLoading, setFollowersLoading] = useState(false);

  // Track newest created_at for kind:3 (following) to reject stale events
  const followingTimestamp = useRef(0);

  // --- Following: always fetch (cheap, single event) ---
  useEffect(() => {
    setFollowing([]);
    setFollowingLoading(true);
    followingTimestamp.current = 0;

    let cancelled = false;

    const followingSub = relayManager.subscribe({
      filters: [{ kinds: [3], authors: [pubkey], limit: 1 }],
      onEvent: (event) => {
        if (cancelled) return;
        if (event.created_at <= followingTimestamp.current) return;
        followingTimestamp.current = event.created_at;

        const pTags = event.tags
          .filter((t) => t[0] === "p" && t[1])
          .map((t) => t[1]);
        setFollowing(pTags);
      },
      onEOSE: () => {
        if (!cancelled) setFollowingLoading(false);
      },
    });

    return () => {
      cancelled = true;
      relayManager.closeSubscription(followingSub);
    };
  }, [pubkey]);

  // --- Followers: only fetch when tab is active ---
  useEffect(() => {
    if (activeTab !== "followers") return;

    setFollowers([]);
    setFollowersLoading(true);

    let cancelled = false;
    const seen = new Set<string>();
    const followerBuffer: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushFollowers = () => {
      flushTimer = null;
      if (followerBuffer.length === 0 || cancelled) return;
      const batch = followerBuffer.splice(0);
      setFollowers((prev) => [...prev, ...batch]);
    };

    const followersSub = relayManager.subscribe({
      filters: [buildFollowersFilter(pubkey)],
      onEvent: (event) => {
        if (cancelled || seen.has(event.pubkey)) return;
        seen.add(event.pubkey);
        followerBuffer.push(event.pubkey);
        if (!flushTimer) {
          flushTimer = setTimeout(flushFollowers, 100);
        }
      },
      onEOSE: () => {
        if (followerBuffer.length > 0) flushFollowers();
        if (!cancelled) setFollowersLoading(false);
      },
    });

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      relayManager.closeSubscription(followersSub);
    };
  }, [pubkey, activeTab]);

  return {
    following,
    followers,
    followingLoading,
    followersLoading,
  };
}
