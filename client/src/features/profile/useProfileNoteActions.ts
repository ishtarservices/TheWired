import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setPinnedNotes } from "../../store/slices/identitySlice";
import type { NostrEvent } from "../../types/nostr";
import { buildRepost, buildReply, buildQuoteNote, buildDeletionEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { toggleLike } from "../reactions/reactionToggle";
import { deleteEvent as deleteEventFromDB } from "../../lib/db/eventStore";
import { removeEvent, removeNote } from "../../store/slices/eventsSlice";
import { parseThreadRef } from "../spaces/noteParser";
import { updatePinnedNotes } from "./pinListWrite";

/** Profile-context note actions — publishes to user's write relays (no space dependency) */
export function useProfileNoteActions(event: NostrEvent) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const pinnedNoteIds = useAppSelector((s) => s.identity.pinnedNoteIds);
  const dispatch = useAppDispatch();

  const canInteract = !!pubkey;
  const canWrite = !!pubkey;

  // Toggle: already liked → kind:5 retracting our reaction, else a `+` kind:7.
  // No space context here, so both go to the user's write relays.
  const like = useCallback(async () => {
    if (!pubkey) return;
    await toggleLike({
      myPubkey: pubkey,
      target: { eventId: event.id, pubkey: event.pubkey, kind: event.kind },
    });
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

  // Optimistic flip, then a read-modify-write against the freshest relay copy
  // (pinListWrite) — never a list rebuilt from these ids, which would wipe
  // pins made on another device or by another client. Nothing published →
  // the flip rolls back (unless a newer list has landed meanwhile).
  const togglePin = useCallback(async (eventId: string) => {
    if (!pubkey) return;
    const isPinned = pinnedNoteIds.includes(eventId);
    const newIds = isPinned
      ? pinnedNoteIds.filter((id) => id !== eventId)
      : [...pinnedNoteIds, eventId];
    const now = Math.floor(Date.now() / 1000);
    dispatch(setPinnedNotes({ noteIds: newIds, createdAt: now }));
    try {
      await updatePinnedNotes(pubkey, { id: eventId, pin: !isPinned });
    } catch (err) {
      console.warn("[pins] not updated:", err instanceof Error ? err.message : err);
      dispatch(setPinnedNotes({ noteIds: pinnedNoteIds, createdAt: now }));
    }
  }, [pubkey, pinnedNoteIds, dispatch]);

  const deleteNote = useCallback(async (eventId: string) => {
    if (!pubkey) return;
    // If this note is pinned, unpin it first (same safe write as a tap;
    // best-effort — a deleted pin is hidden on read either way)
    if (pinnedNoteIds.includes(eventId)) {
      const now = Math.floor(Date.now() / 1000);
      dispatch(setPinnedNotes({ noteIds: pinnedNoteIds.filter((id) => id !== eventId), createdAt: now }));
      updatePinnedNotes(pubkey, { id: eventId, pin: false }).catch(() => {});
    }
    // Remove from Redux + IndexedDB immediately (optimistic)
    dispatch(removeEvent(eventId));
    dispatch(removeNote({ pubkey: event.pubkey, eventId }));
    deleteEventFromDB(eventId).catch(() => {});
    // Publish kind:5 deletion event
    const unsigned = buildDeletionEvent(
      pubkey,
      { eventIds: [eventId] },
      undefined,
      ["1"],
    );
    await signAndPublish(unsigned);
  }, [pubkey, event.pubkey, pinnedNoteIds, dispatch]);

  return { like, repost, reply, quote, togglePin, deleteNote, canInteract, canWrite };
}
