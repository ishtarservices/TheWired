import { useCallback } from "react";
import { useAppSelector } from "../../store/hooks";
import type { NostrEvent } from "../../types/nostr";
import { buildReaction, buildRepost, buildReply, buildQuoteNote } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { parseThreadRef } from "./noteParser";

export function useNoteActions(event: NostrEvent) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const activeSpace = useAppSelector((s) => {
    const id = s.spaces.activeSpaceId;
    return id ? s.spaces.list.find((sp) => sp.id === id) : undefined;
  });

  const canInteract = !!pubkey;
  const canWrite = canInteract && activeSpace?.mode === "read-write";

  const like = useCallback(async () => {
    if (!pubkey || !canInteract) return;
    const unsigned = buildReaction(
      pubkey,
      { eventId: event.id, pubkey: event.pubkey, kind: event.kind },
    );
    await signAndPublish(unsigned, activeSpace?.hostRelay ? [activeSpace.hostRelay] : undefined);
  }, [pubkey, canInteract, event.id, event.pubkey, event.kind, activeSpace?.hostRelay]);

  const repost = useCallback(async () => {
    if (!pubkey || !canWrite) return;
    const unsigned = buildRepost(
      pubkey,
      { id: event.id, pubkey: event.pubkey },
      JSON.stringify(event),
    );
    await signAndPublish(unsigned, activeSpace?.hostRelay ? [activeSpace.hostRelay] : undefined);
  }, [pubkey, canWrite, event, activeSpace?.hostRelay]);

  const reply = useCallback(async (content: string) => {
    if (!pubkey || !canWrite || !content.trim()) return;
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
    await signAndPublish(unsigned, activeSpace?.hostRelay ? [activeSpace.hostRelay] : undefined);
  }, [pubkey, canWrite, event, activeSpace?.hostRelay]);

  const quote = useCallback(async (content: string) => {
    if (!pubkey || !canWrite || !content.trim()) return;
    const unsigned = buildQuoteNote(
      pubkey,
      content.trim(),
      { eventId: event.id, pubkey: event.pubkey },
    );
    await signAndPublish(unsigned, activeSpace?.hostRelay ? [activeSpace.hostRelay] : undefined);
  }, [pubkey, canWrite, event, activeSpace?.hostRelay]);

  return { like, repost, reply, quote, canInteract, canWrite };
}
