import { useEffect, useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "../../lib/nostr/constants";
import { processIncomingEvent } from "../../lib/nostr/eventPipeline";
import { isValidEventStructure } from "../../lib/nostr/validation";
import type { NostrEvent } from "../../types/nostr";

/**
 * Resolve the original event from a kind:6 repost.
 * 1. Try parsing the repost's content as JSON (NIP-18 embeds the original)
 * 2. Fall back to fetching by ID from relays
 */
export function useRepostedEvent(repostEvent: NostrEvent): NostrEvent | null {
  // Extract target event ID from "e" tag
  const targetId = useMemo(() => {
    return repostEvent.tags.find((t) => t[0] === "e")?.[1] ?? null;
  }, [repostEvent.tags]);

  // Try to parse embedded event from content — process through full pipeline
  // so music events (kind:31683/33123) get indexed into musicSlice
  useEffect(() => {
    if (!repostEvent.content) return;
    try {
      const parsed = JSON.parse(repostEvent.content);
      if (isValidEventStructure(parsed)) {
        processIncomingEvent(parsed, "embedded").catch(() => {});
      }
    } catch {
      // Content is not valid JSON — will fall back to subscription
    }
  }, [repostEvent.content]);

  // Select from store
  const event = useAppSelector((s) =>
    targetId ? eventsSelectors.selectById(s.events, targetId) : undefined,
  );

  // If not in store, subscribe by ID.
  // Only depend on targetId — NOT on `event`. The subscription should stay
  // open until cleanup (unmount or targetId change). Once the event arrives
  // via processIncomingEvent → Redux, the selector above will return it.
  useEffect(() => {
    if (!targetId) return;

    const subId = subscriptionManager.subscribe({
      filters: [{ ids: [targetId] }],
      relayUrls: PROFILE_RELAYS,
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [targetId]);

  return event ?? null;
}
