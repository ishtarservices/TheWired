import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { relayManager } from "@/lib/nostr/relayManager";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "@/lib/nostr/constants";
import { signAndPublish } from "@/lib/nostr/publish";
import { EVENT_KINDS } from "@/types/nostr";
import type { NostrEvent } from "@/types/nostr";
import { useAppSelector } from "@/store/hooks";
import {
  type ProfileShowcase,
  type ShowcaseItem,
  DEFAULT_SHOWCASE,
  SHOWCASE_D_TAG,
  MAX_SHOWCASE_ITEMS,
  getCachedShowcase,
  getCachedShowcaseTimestamp,
  cacheShowcase,
  invalidateShowcaseCache,
  parseShowcase,
  buildShowcaseEvent,
} from "./profileShowcase";

/**
 * Fetch and manage a user's profile music showcase (picks).
 *
 * Same caching pattern as useProfileSettings:
 *  1. Synchronous in-memory cache check.
 *  2. Cache miss → one-shot relay subscription.
 *  3. Result cached for 5 min.
 *
 * Also subscribes for any showcase items missing from the Redux music store.
 */
export function useProfileShowcase(pubkey: string | null) {
  const [showcase, setShowcase] = useState<ProfileShowcase>(
    () => (pubkey ? getCachedShowcase(pubkey) : null) ?? DEFAULT_SHOWCASE,
  );
  const [loading, setLoading] = useState(() =>
    pubkey ? !getCachedShowcase(pubkey) : false,
  );

  const newestAt = useRef(0);

  // ── Fetch showcase event from relays ──
  useEffect(() => {
    if (!pubkey) {
      setShowcase(DEFAULT_SHOWCASE);
      setLoading(false);
      return;
    }

    const cached = getCachedShowcase(pubkey);
    if (cached) {
      setShowcase(cached);
      newestAt.current = getCachedShowcaseTimestamp(pubkey);
      setLoading(false);
      return;
    }

    setLoading(true);
    newestAt.current = 0;
    let found = false;
    let cancelled = false;

    const subId = relayManager.subscribe({
      filters: [
        {
          kinds: [EVENT_KINDS.APP_SPECIFIC_DATA],
          authors: [pubkey],
          "#d": [SHOWCASE_D_TAG],
          limit: 1,
        },
      ],
      relayUrls: PROFILE_RELAYS,
      onEvent: (event: NostrEvent) => {
        if (cancelled) return;
        if (event.created_at <= newestAt.current) return;
        newestAt.current = event.created_at;

        const parsed = parseShowcase(event.content);
        cacheShowcase(pubkey, parsed, event.created_at);
        setShowcase(parsed);
        found = true;
      },
      onEOSE: () => {
        if (cancelled) return;
        if (!found) {
          cacheShowcase(pubkey, DEFAULT_SHOWCASE, 0);
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

  // ── Fetch missing showcase items from relays ──
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);

  useEffect(() => {
    if (showcase.items.length === 0) return;

    const missingAddrIds = showcase.items
      .filter((item) => {
        if (item.type === "track") return !tracks[item.addressableId];
        if (item.type === "album") return !albums[item.addressableId];
        return false;
      })
      .map((item) => item.addressableId);

    if (missingAddrIds.length === 0) return;

    // Build filters for addressable events using their kind+pubkey+d-tag
    const trackFilters = missingAddrIds
      .filter((id) => id.startsWith("31683:"))
      .map((id) => {
        const parts = id.split(":");
        return { kinds: [EVENT_KINDS.MUSIC_TRACK], authors: [parts[1]], "#d": [parts.slice(2).join(":")] };
      });
    const albumFilters = missingAddrIds
      .filter((id) => id.startsWith("33123:"))
      .map((id) => {
        const parts = id.split(":");
        return { kinds: [EVENT_KINDS.MUSIC_ALBUM], authors: [parts[1]], "#d": [parts.slice(2).join(":")] };
      });

    const filters = [...trackFilters, ...albumFilters];
    if (filters.length === 0) return;

    const subId = subscriptionManager.subscribe({ filters, relayUrls: PROFILE_RELAYS });

    return () => {
      subscriptionManager.close(subId);
    };
    // Only re-run when showcase items change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcase.items]);

  // ── Mutations (own showcase only) ──

  const publishShowcase = useCallback(
    async (next: ProfileShowcase) => {
      if (!pubkey) return;
      const unsigned = buildShowcaseEvent(pubkey, next);
      await signAndPublish(unsigned);
      invalidateShowcaseCache(pubkey);
      cacheShowcase(pubkey, next, Math.floor(Date.now() / 1000));
      setShowcase(next);
    },
    [pubkey],
  );

  const addItem = useCallback(
    async (item: ShowcaseItem) => {
      if (showcase.items.length >= MAX_SHOWCASE_ITEMS) return;
      if (showcase.items.some((i) => i.addressableId === item.addressableId)) return;
      const next = { items: [...showcase.items, item] };
      await publishShowcase(next);
    },
    [showcase, publishShowcase],
  );

  const removeItem = useCallback(
    async (addressableId: string) => {
      const next = {
        items: showcase.items.filter((i) => i.addressableId !== addressableId),
      };
      await publishShowcase(next);
    },
    [showcase, publishShowcase],
  );

  const reorderItems = useCallback(
    async (items: ShowcaseItem[]) => {
      await publishShowcase({ items });
    },
    [publishShowcase],
  );

  const isInShowcase = useCallback(
    (addressableId: string) =>
      showcase.items.some((i) => i.addressableId === addressableId),
    [showcase],
  );

  // Resolved items from Redux store
  const resolvedTracks = useMemo(
    () =>
      showcase.items
        .filter((i) => i.type === "track" && tracks[i.addressableId])
        .map((i) => tracks[i.addressableId]),
    [showcase.items, tracks],
  );

  const resolvedAlbums = useMemo(
    () =>
      showcase.items
        .filter((i) => i.type === "album" && albums[i.addressableId])
        .map((i) => albums[i.addressableId]),
    [showcase.items, albums],
  );

  return {
    showcase,
    loading,
    addItem,
    removeItem,
    reorderItems,
    isInShowcase,
    resolvedTracks,
    resolvedAlbums,
  };
}
