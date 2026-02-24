import { useEffect, useState, useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { buildNotesFilter } from "../../lib/nostr/filterBuilder";
import type { NostrEvent } from "../../types/nostr";

export function useProfileNotes(pubkey: string) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    const subId = subscriptionManager.subscribe({
      filters: [buildNotesFilter(pubkey)],
      onEOSE: () => setLoading(false),
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [pubkey]);

  const noteIds = useAppSelector(
    (s) => s.events.notesByAuthor[pubkey],
  );
  const events = useAppSelector((s) => s.events);

  const notes = useMemo(() => {
    if (!noteIds) return [];
    return noteIds
      .map((id) => eventsSelectors.selectById(events, id))
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => b.created_at - a.created_at);
  }, [noteIds, events]);

  return { notes, loading };
}
