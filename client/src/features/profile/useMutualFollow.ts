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

/** Check mutual follow status between current user and a target pubkey */
export function useMutualFollow(pubkey: string): MutualFollowState {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const followList = useAppSelector((s) => s.identity.followList);
  const [theyFollowMe, setTheyFollowMe] = useState(false);
  const [loading, setLoading] = useState(true);

  const iFollow = useMemo(
    () => followList.includes(pubkey),
    [followList, pubkey],
  );

  useEffect(() => {
    if (!myPubkey || !pubkey || myPubkey === pubkey) {
      setLoading(false);
      return;
    }

    setTheyFollowMe(false);
    setLoading(true);

    let eoseCount = 0;
    const totalRelays = PROFILE_RELAYS.length;

    const subId = relayManager.subscribe({
      filters: [
        { kinds: [EVENT_KINDS.FOLLOW_LIST], authors: [pubkey], limit: 1 },
      ],
      relayUrls: PROFILE_RELAYS,
      onEvent: (event) => {
        if (event.pubkey !== pubkey) return;
        const followsPubkeys = event.tags
          .filter((t) => t[0] === "p" && t[1])
          .map((t) => t[1]);
        setTheyFollowMe(followsPubkeys.includes(myPubkey));
      },
      onEOSE: () => {
        eoseCount++;
        if (eoseCount >= totalRelays) {
          setLoading(false);
          relayManager.closeSubscription(subId);
        }
      },
    });

    return () => {
      relayManager.closeSubscription(subId);
    };
  }, [myPubkey, pubkey]);

  return {
    iFollow,
    theyFollowMe,
    isMutual: iFollow && theyFollowMe,
    loading,
  };
}
