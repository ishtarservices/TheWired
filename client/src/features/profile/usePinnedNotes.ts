import { useEffect, useState, useMemo, useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import { relayManager } from "@/lib/nostr/relayManager";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { eventsSelectors } from "@/store/slices/eventsSlice";
import { EVENT_KINDS } from "@/types/nostr";
import type { NostrEvent } from "@/types/nostr";

/**
 * Hook to fetch and resolve pinned notes for a profile.
 *
 * - For the logged-in user: reads pinnedNoteIds from identitySlice (loaded at login).
 * - For other users: subscribes for kind:10001 from relays via relayManager
 *   (which supports onEvent for non-pipeline-indexed kinds).
 * - Resolves actual events from the Redux store, fetching missing ones from relays.
 */
export function usePinnedNotes(pubkey: string) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isMe = pubkey === myPubkey;

  // Own pinned notes from identity slice
  const ownPinnedIds = useAppSelector((s) => s.identity.pinnedNoteIds);

  // Foreign user pinned note IDs (local state)
  const [foreignPinnedIds, setForeignPinnedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(!isMe);
  // Track latest created_at to handle replaceable events
  const latestCreatedAt = useRef(0);

  // Subscribe for kind:10001 for foreign profiles using relayManager (supports onEvent)
  useEffect(() => {
    if (isMe) {
      setLoading(false);
      return;
    }

    setForeignPinnedIds([]);
    setLoading(true);
    latestCreatedAt.current = 0;

    let eoseCount = 0;
    const subId = relayManager.subscribe({
      filters: [
        { kinds: [EVENT_KINDS.PINNED_NOTES], authors: [pubkey], limit: 1 },
      ],
      onEvent: (event: NostrEvent) => {
        if (event.pubkey !== pubkey || event.kind !== EVENT_KINDS.PINNED_NOTES) return;
        // Only accept newer replaceable events
        if (event.created_at <= latestCreatedAt.current) return;
        latestCreatedAt.current = event.created_at;
        const noteIds = event.tags
          .filter((t) => t[0] === "e" && t[1])
          .map((t) => t[1]);
        setForeignPinnedIds(noteIds);
      },
      onEOSE: () => {
        eoseCount++;
        if (eoseCount === 1) setLoading(false);
      },
    });

    return () => {
      relayManager.closeSubscription(subId);
    };
  }, [pubkey, isMe]);

  const pinnedNoteIds = isMe ? ownPinnedIds : foreignPinnedIds;

  // Resolve pinned events from the Redux store
  const allEvents = useAppSelector((s) => s.events);
  const pinnedEvents = useMemo(() => {
    const events: NostrEvent[] = [];
    for (const id of pinnedNoteIds) {
      const event = eventsSelectors.selectById(allEvents, id);
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
    });

    return () => {
      subscriptionManager.close(subId);
    };
    // Only re-run when pinnedNoteIds changes, not on every Redux update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedNoteIds]);

  return { pinnedNoteIds, pinnedEvents, loading };
}
