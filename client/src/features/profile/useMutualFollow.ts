import { useEffect, useState, useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { relayManager } from "@/lib/nostr/relayManager";
import { EVENT_KINDS } from "@/types/nostr";
import { PROFILE_RELAYS } from "@/lib/nostr/constants";

interface MutualFollowState {
  iFollow: boolean;
  theyFollowMe: boolean;
  isMutual: boolean;
  loading: boolean;
}

/**
 * Check mutual follow status between current user and a target pubkey.
 *
 * Uses two sources for `theyFollowMe`:
 * 1. Local: Redux `knownFollowers` — instant for friends (populated by accept flow)
 * 2. Relay: kind:3 query — resolves on first EOSE with 8s timeout fallback
 *
 * `loading` tracks the relay check but should NOT be used to gate UI actions
 * like the follow button — use `followListCreatedAt > 0` for that instead.
 */
export function useMutualFollow(pubkey: string): MutualFollowState {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const followList = useAppSelector((s) => s.identity.followList);
  const knownFollowers = useAppSelector((s) => s.identity.knownFollowers);

  const [theyFollowMeRelay, setTheyFollowMeRelay] = useState(false);
  const [loading, setLoading] = useState(true);

  const iFollow = useMemo(
    () => followList.includes(pubkey),
    [followList, pubkey],
  );

  const knownToFollowMe = useMemo(
    () => knownFollowers.includes(pubkey),
    [knownFollowers, pubkey],
  );

  useEffect(() => {
    if (!myPubkey || !pubkey || myPubkey === pubkey) {
      setLoading(false);
      return;
    }

    // If already known from local state, skip relay query
    if (knownToFollowMe) {
      setLoading(false);
      return;
    }

    setTheyFollowMeRelay(false);
    setLoading(true);
    let cancelled = false;

    const subId = relayManager.subscribe({
      filters: [
        { kinds: [EVENT_KINDS.FOLLOW_LIST], authors: [pubkey], limit: 1 },
      ],
      relayUrls: PROFILE_RELAYS,
      onEvent: (event) => {
        if (cancelled || event.pubkey !== pubkey) return;
        const followsPubkeys = event.tags
          .filter((t) => t[0] === "p" && t[1])
          .map((t) => t[1]);
        setTheyFollowMeRelay(followsPubkeys.includes(myPubkey));
      },
      onEOSE: () => {
        // Resolve on first EOSE from any relay — don't wait for all
        if (cancelled) return;
        cancelled = true;
        setLoading(false);
        clearTimeout(timer);
        relayManager.closeSubscription(subId);
      },
    });

    // Safety timeout: unblock if no relay responds
    const timer = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setLoading(false);
      relayManager.closeSubscription(subId);
    }, 8_000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      relayManager.closeSubscription(subId);
    };
  }, [myPubkey, pubkey, knownToFollowMe]);

  const theyFollowMe = knownToFollowMe || theyFollowMeRelay;

  return {
    iFollow,
    theyFollowMe,
    isMutual: iFollow && theyFollowMe,
    loading,
  };
}
