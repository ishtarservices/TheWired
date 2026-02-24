import { useEffect, useState } from "react";
import type { Kind0Profile } from "../../types/profile";
import { relayManager } from "../../lib/nostr/relayManager";
import { parseProfile } from "./profileParser";
import { getProfile, putProfile } from "../../lib/db/profileStore";

/** Cache-first profile fetching for any pubkey */
export function useProfile(pubkey: string | null) {
  const [profile, setProfile] = useState<Kind0Profile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pubkey) {
      setProfile(null);
      return;
    }

    let cancelled = false;
    let subId: string | null = null;
    setLoading(true);

    // Try cache first
    getProfile(pubkey).then((cached) => {
      if (cancelled) return;
      if (cached) {
        setProfile(cached);
        setLoading(false);
      }

      // Fetch fresh from relays
      subId = relayManager.subscribe({
        filters: [{ kinds: [0], authors: [pubkey], limit: 1 }],
        onEvent: (event) => {
          if (cancelled) return;
          const parsed = parseProfile(event);
          if (parsed) {
            setProfile(parsed);
            putProfile(pubkey, parsed);
          }
        },
        onEOSE: () => {
          if (!cancelled) setLoading(false);
        },
      });
    });

    return () => {
      cancelled = true;
      if (subId) relayManager.closeSubscription(subId);
    };
  }, [pubkey]);

  return { profile, loading };
}
