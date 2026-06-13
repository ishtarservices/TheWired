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
  // Reply/repost/quote are interactions on the note itself, not posts into the
  // space — so they're allowed in the Feed and read-only feed spaces too.
  const canWrite = canInteract;
  // Member posts in read-write spaces target the space's host relay. Feed and
  // read-only interactions broadcast to the user's write relays instead — the
  // note's author isn't on a read-only space's host relay anyway.
  const spaceMode = activeSpace?.mode;
  const hostRelay = activeSpace?.hostRelay;

  const like = useCallback(async () => {
    if (!pubkey || !canInteract) return;
    const unsigned = buildReaction(
      pubkey,
      { eventId: event.id, pubkey: event.pubkey, kind: event.kind },
    );
    await signAndPublish(unsigned, spaceMode === "read-write" && hostRelay ? [hostRelay] : undefined);
  }, [pubkey, canInteract, event.id, event.pubkey, event.kind, spaceMode, hostRelay]);

  const repost = useCallback(async () => {
    if (!pubkey || !canWrite) return;
    const unsigned = buildRepost(
      pubkey,
      { id: event.id, pubkey: event.pubkey },
      JSON.stringify(event),
    );
    await signAndPublish(unsigned, spaceMode === "read-write" && hostRelay ? [hostRelay] : undefined);
  }, [pubkey, canWrite, event, spaceMode, hostRelay]);

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
    await signAndPublish(unsigned, spaceMode === "read-write" && hostRelay ? [hostRelay] : undefined);
  }, [pubkey, canWrite, event, spaceMode, hostRelay]);

  const quote = useCallback(async (content: string) => {
    if (!pubkey || !canWrite || !content.trim()) return;
    const unsigned = buildQuoteNote(
      pubkey,
      content.trim(),
      { eventId: event.id, pubkey: event.pubkey },
    );
    await signAndPublish(unsigned, spaceMode === "read-write" && hostRelay ? [hostRelay] : undefined);
  }, [pubkey, canWrite, event, spaceMode, hostRelay]);

  return { like, repost, reply, quote, canInteract, canWrite };
}
