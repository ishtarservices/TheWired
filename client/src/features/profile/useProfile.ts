import { useEffect, useState } from "react";
import type { Kind0Profile } from "../../types/profile";
import { profileCache } from "../../lib/nostr/profileCache";

/** Cache-first profile fetching for any pubkey, using the global profile cache */
export function useProfile(pubkey: string | null) {
  const [profile, setProfile] = useState<Kind0Profile | null>(
    () => (pubkey ? profileCache.getCached(pubkey) : null),
  );

  useEffect(() => {
    if (!pubkey) {
      setProfile(null);
      return;
    }

    // Sync check for immediate render
    const cached = profileCache.getCached(pubkey);
    if (cached) {
      setProfile(cached);
    }

    // Subscribe — handles IDB load, batched relay fetch, and freshness guards
    const unsub = profileCache.subscribe(pubkey, (p) => {
      setProfile(p);
    });

    return unsub;
  }, [pubkey]);

  return { profile };
}
