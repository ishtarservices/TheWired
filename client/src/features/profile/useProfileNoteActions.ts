import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setPinnedNotes } from "../../store/slices/identitySlice";
import type { NostrEvent } from "../../types/nostr";
import { buildReaction, buildRepost, buildReply, buildQuoteNote, buildPinnedNotesEvent, buildDeletionEvent } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { saveUserState } from "../../lib/db/userStateStore";
import { deleteEvent as deleteEventFromDB } from "../../lib/db/eventStore";
import { removeEvent, removeNote } from "../../store/slices/eventsSlice";
import { parseThreadRef } from "../spaces/noteParser";

/** Profile-context note actions — publishes to user's write relays (no space dependency) */
export function useProfileNoteActions(event: NostrEvent) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const pinnedNoteIds = useAppSelector((s) => s.identity.pinnedNoteIds);
  const dispatch = useAppDispatch();

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

  const togglePin = useCallback(async (eventId: string) => {
    if (!pubkey) return;
    const isPinned = pinnedNoteIds.includes(eventId);
    const newIds = isPinned
      ? pinnedNoteIds.filter((id) => id !== eventId)
      : [...pinnedNoteIds, eventId];
    const now = Math.floor(Date.now() / 1000);
    // Optimistic update
    dispatch(setPinnedNotes({ noteIds: newIds, createdAt: now }));
    const unsigned = buildPinnedNotesEvent(pubkey, newIds);
    await signAndPublish(unsigned);
    saveUserState("pinned_notes", newIds);
  }, [pubkey, pinnedNoteIds, dispatch]);

  const deleteNote = useCallback(async (eventId: string) => {
    if (!pubkey) return;
    // If this note is pinned, unpin it first
    if (pinnedNoteIds.includes(eventId)) {
      const newPinIds = pinnedNoteIds.filter((id) => id !== eventId);
      const now = Math.floor(Date.now() / 1000);
      dispatch(setPinnedNotes({ noteIds: newPinIds, createdAt: now }));
      const pinUnsigned = buildPinnedNotesEvent(pubkey, newPinIds);
      signAndPublish(pinUnsigned).catch(() => {});
      saveUserState("pinned_notes", newPinIds);
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
