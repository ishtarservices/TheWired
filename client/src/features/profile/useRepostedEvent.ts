import { useEffect, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { eventsSelectors, addEvent } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { isValidEventStructure } from "../../lib/nostr/validation";
import type { NostrEvent } from "../../types/nostr";

/**
 * Resolve the original event from a kind:6 repost.
 * 1. Try parsing the repost's content as JSON (NIP-18 embeds the original)
 * 2. Fall back to fetching by ID from relays
 */
export function useRepostedEvent(repostEvent: NostrEvent): NostrEvent | null {
  const dispatch = useAppDispatch();

  // Extract target event ID from "e" tag
  const targetId = useMemo(() => {
    return repostEvent.tags.find((t) => t[0] === "e")?.[1] ?? null;
  }, [repostEvent.tags]);

  // Try to parse embedded event from content
  useEffect(() => {
    if (!repostEvent.content) return;
    try {
      const parsed = JSON.parse(repostEvent.content);
      if (isValidEventStructure(parsed)) {
        dispatch(addEvent(parsed));
      }
    } catch {
      // Content is not valid JSON — will fall back to subscription
    }
  }, [repostEvent.content, dispatch]);

  // Select from store
  const event = useAppSelector((s) =>
    targetId ? eventsSelectors.selectById(s.events, targetId) : undefined,
  );

  // If not in store, subscribe by ID
  useEffect(() => {
    if (!targetId || event) return;

    const subId = subscriptionManager.subscribe({
      filters: [{ ids: [targetId] }],
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [targetId, event]);

  return event ?? null;
}
