import { useEffect, useState, useMemo, useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import { relayManager } from "@/lib/nostr/relayManager";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "@/lib/nostr/constants";
import { eventsSelectors } from "@/store/slices/eventsSlice";
import { EVENT_KINDS } from "@/types/nostr";
import type { NostrEvent } from "@/types/nostr";
import { useAuthorWriteRelays } from "./useProfileNotes";
import { isNewerEvent, pinnedIdsFromTags } from "./pinList";

/**
 * Hook to fetch and resolve pinned notes for a profile.
 *
 * - For the logged-in user: reads pinnedNoteIds from identitySlice (loaded at login).
 * - For other users: subscribes for kind:10001 from relays via relayManager
 *   (which supports onEvent for non-pipeline-indexed kinds) — PROFILE_RELAYS
 *   plus the author's own NIP-65 write relays (outbox): a pin list lives
 *   wherever its author publishes.
 * - Resolves actual events from the Redux store, fetching missing ones from relays.
 *
 * `pinnedEvents` is newest pin first (NIP-51 appends, so reverse tag order).
 */
export function usePinnedNotes(pubkey: string) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isMe = pubkey === myPubkey;

  // Own pinned notes from identity slice
  const ownPinnedIds = useAppSelector((s) => s.identity.pinnedNoteIds);

  // Foreign user pinned note IDs (local state)
  const [foreignPinnedIds, setForeignPinnedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isMe);
  // The newest copy seen (replaceable: newest created_at, then lowest id)
  const latest = useRef<NostrEvent | null>(null);

  const authorRelays = useAuthorWriteRelays(isMe ? null : pubkey);
  const relayUrls = useMemo(
    () => [...new Set([...PROFILE_RELAYS, ...authorRelays])],
    [authorRelays],
  );
  const relayKey = relayUrls.join(",");

  // A different profile starts from nothing.
  useEffect(() => {
    latest.current = null;
    setForeignPinnedIds([]);
  }, [pubkey]);

  // Subscribe for kind:10001 for foreign profiles using relayManager (supports onEvent).
  // The author's outbox arriving re-subscribes wider without dropping what was read.
  useEffect(() => {
    if (isMe) {
      setLoading(false);
      return;
    }

    setLoading(true);
    let eoseCount = 0;
    const subId = relayManager.subscribe({
      filters: [
        { kinds: [EVENT_KINDS.PINNED_NOTES], authors: [pubkey], limit: 1 },
      ],
      relayUrls,
      onEvent: (event: NostrEvent) => {
        if (event.pubkey !== pubkey || event.kind !== EVENT_KINDS.PINNED_NOTES) return;
        // Only accept newer replaceable events
        if (latest.current && !isNewerEvent(event, latest.current)) return;
        latest.current = event;
        setForeignPinnedIds(pinnedIdsFromTags(event.tags));
      },
      onEOSE: () => {
        eoseCount++;
        if (eoseCount === 1) setLoading(false);
      },
    });

    return () => {
      relayManager.closeSubscription(subId);
    };
    // relayKey stands in for relayUrls (a new array on every author-relay update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, isMe, relayKey]);

  const pinnedNoteIds = isMe ? ownPinnedIds : foreignPinnedIds;

  // Resolve pinned events from the Redux store, newest pin first
  const allEvents = useAppSelector((s) => s.events);
  const pinnedEvents = useMemo(() => {
    const events: NostrEvent[] = [];
    for (let i = pinnedNoteIds.length - 1; i >= 0; i--) {
      const event = eventsSelectors.selectById(allEvents, pinnedNoteIds[i]);
      if (event) events.push(event);
    }
    return events;
  }, [pinnedNoteIds, allEvents]);

  // Fetch any missing pinned events from relays (these are kind:1 notes,
  // which flow through the pipeline and get added to Redux automatically)
  useEffect(() => {
    if (pinnedNoteIds.length === 0) return;

    const missingIds = pinnedNoteIds.filter(
      (id) => !eventsSelectors.selectById(allEvents, id),
    );
    if (missingIds.length === 0) return;

    const subId = subscriptionManager.subscribe({
      filters: [{ ids: missingIds }],
      relayUrls,
    });

    return () => {
      subscriptionManager.close(subId);
    };
    // Only re-run when pinnedNoteIds (or the relay set) changes, not on every Redux update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedNoteIds, relayKey]);

  return { pinnedNoteIds, pinnedEvents, loading };
}
