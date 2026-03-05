import { useCallback } from "react";
import { useAppSelector } from "../../store/hooks";
import type { NostrEvent } from "../../types/nostr";
import { buildReaction, buildRepost, buildReply, buildQuoteNote } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { parseThreadRef } from "../spaces/noteParser";

/** Profile-context note actions — publishes to user's write relays (no space dependency) */
export function useProfileNoteActions(event: NostrEvent) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);

  const canInteract = !!pubkey;
  const canWrite = !!pubkey;

  const like = useCallback(async () => {
    if (!pubkey) return;
    const unsigned = buildReaction(
      pubkey,
      { eventId: event.id, pubkey: event.pubkey, kind: event.kind },
    );
    await signAndPublish(unsigned);
  }, [pubkey, event.id, event.pubkey, event.kind]);

  const repost = useCallback(async () => {
    if (!pubkey) return;
    const unsigned = buildRepost(
      pubkey,
      { id: event.id, pubkey: event.pubkey },
      JSON.stringify(event),
    );
    await signAndPublish(unsigned);
  }, [pubkey, event]);

  const reply = useCallback(async (content: string) => {
    if (!pubkey || !content.trim()) return;
    const threadRef = parseThreadRef(event);
    const unsigned = buildReply(
      pubkey,
      content.trim(),
      {
        eventId: event.id,
        pubkey: event.pubkey,
        rootId: threadRef.rootId ?? undefined,
      },
    );
    await signAndPublish(unsigned);
  }, [pubkey, event]);

  const quote = useCallback(async (content: string) => {
    if (!pubkey || !content.trim()) return;
    const unsigned = buildQuoteNote(
      pubkey,
      content.trim(),
      { eventId: event.id, pubkey: event.pubkey },
    );
    await signAndPublish(unsigned);
  }, [pubkey, event.id, event.pubkey]);

  return { like, repost, reply, quote, canInteract, canWrite };
}
