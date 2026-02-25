import { useEffect, useState, useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { buildNotesFilter } from "../../lib/nostr/filterBuilder";
import type { NostrEvent } from "../../types/nostr";

export function useProfileNotes(pubkey: string) {
  const [eoseReceived, setEoseReceived] = useState(false);

  useEffect(() => {
    setEoseReceived(false);

    const subId = subscriptionManager.subscribe({
      filters: [buildNotesFilter(pubkey)],
      onEOSE: () => setEoseReceived(true),
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [pubkey]);

  const noteIds = useAppSelector(
    (s) => s.events.notesByAuthor[pubkey],
  );
  const entities = useAppSelector((s) => s.events.entities);

  const notes = useMemo(() => {
    if (!noteIds) return [];
    return noteIds
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => b.created_at - a.created_at);
  }, [noteIds, entities]);

  // Show loading only when we have no notes yet AND EOSE hasn't arrived
  const loading = notes.length === 0 && !eoseReceived;

  return { notes, loading, eoseReceived };
}
