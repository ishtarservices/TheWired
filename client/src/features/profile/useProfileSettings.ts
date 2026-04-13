import { useState, useEffect, useCallback, useRef } from "react";
import { relayManager } from "@/lib/nostr/relayManager";
import { PROFILE_RELAYS } from "@/lib/nostr/constants";
import { signAndPublish } from "@/lib/nostr/publish";
import { EVENT_KINDS } from "@/types/nostr";
import type { NostrEvent } from "@/types/nostr";
import {
  type ProfileSettings,
  DEFAULT_PROFILE_SETTINGS,
  D_TAG,
  getCachedSettings,
  getCachedEventTimestamp,
  cacheSettings,
  invalidateCache,
  parseProfileSettings,
  buildProfileSettingsEvent,
} from "./profileSettings";

/**
 * Fetch (and optionally update) a user's profile display settings.
 *
 * Cache strategy:
 *  1. Synchronous in-memory cache check (no relay roundtrip if fresh).
 *  2. On cache miss → one-shot relay subscription (limit:1, close on EOSE).
 *  3. Result cached for 5 min so repeated profile views are instant.
 */
export function useProfileSettings(pubkey: string | null) {
  const [settings, setSettings] = useState<ProfileSettings>(
    () => (pubkey ? getCachedSettings(pubkey) : null) ?? DEFAULT_PROFILE_SETTINGS,
  );
  const [loading, setLoading] = useState(() => (pubkey ? !getCachedSettings(pubkey) : false));

  // Track the most recent event's created_at to ignore stale duplicates
  const newestAt = useRef(0);

  useEffect(() => {
    if (!pubkey) {
      setSettings(DEFAULT_PROFILE_SETTINGS);
      setLoading(false);
      return;
    }

    // 1. Cache hit — return immediately
    const cached = getCachedSettings(pubkey);
    if (cached) {
      setSettings(cached);
      newestAt.current = getCachedEventTimestamp(pubkey);
      setLoading(false);
      return;
    }

    // 2. Cache miss — fetch from relays
    setLoading(true);
    newestAt.current = 0;
    let found = false;
    let cancelled = false;

    const subId = relayManager.subscribe({
      filters: [
        {
          kinds: [EVENT_KINDS.APP_SPECIFIC_DATA],
          authors: [pubkey],
          "#d": [D_TAG],
          limit: 1,
        },
      ],
      relayUrls: PROFILE_RELAYS,
      onEvent: (event: NostrEvent) => {
        if (cancelled) return;
        // Addressable events: keep the newest created_at
        if (event.created_at <= newestAt.current) return;
        newestAt.current = event.created_at;

        const parsed = parseProfileSettings(event.content);
        cacheSettings(pubkey, parsed, event.created_at);
        setSettings(parsed);
        found = true;
      },
      onEOSE: () => {
        if (cancelled) return;
        if (!found) {
          // No event on any relay — cache defaults so we don't re-fetch
          cacheSettings(pubkey, DEFAULT_PROFILE_SETTINGS, 0);
        }
        setLoading(false);
        relayManager.closeSubscription(subId);
      },
    });

    return () => {
      cancelled = true;
      relayManager.closeSubscription(subId);
    };
  }, [pubkey]);

  /** Publish updated settings (own profile only) */
  const updateSettings = useCallback(
    async (next: ProfileSettings) => {
      if (!pubkey) return;
      const unsigned = buildProfileSettingsEvent(pubkey, next);
      await signAndPublish(unsigned);
      // Optimistic: update local state + cache immediately
      invalidateCache(pubkey);
      cacheSettings(pubkey, next, Math.floor(Date.now() / 1000));
      setSettings(next);
    },
    [pubkey],
  );

  return { settings, loading, updateSettings };
}
