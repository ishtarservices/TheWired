// Receive side of the kind-20016 media-key envelopes. Deliberately free of
// livekit-client imports: the event pipeline (which sees every unwrapped
// gift wrap) delivers here, and whichever E2EE session is active picks the
// envelopes up. Envelopes that arrive with no session are dropped — keys
// are only meaningful while we are in the room they name.
import type { DMMediaKeyEnvelope } from "@ishtarservices/shared-types";
import { LRUCache } from "lru-cache";

export type MediaKeyReceiver = (senderPubkey: string, envelope: DMMediaKeyEnvelope) => void;

let receiver: MediaKeyReceiver | null = null;
/** Wrap ids already delivered — a relay replay must never re-install keys. */
const seenWrapIds = new LRUCache<string, true>({ max: 2000 });

/** Install the active session's receiver; returns the uninstaller. */
export function registerMediaKeyReceiver(fn: MediaKeyReceiver): () => void {
  receiver = fn;
  return () => {
    if (receiver === fn) receiver = null;
  };
}

/**
 * Called by the event pipeline for every unwrapped kind-20016 rumor. A wrap
 * counts as seen only once a session consumed it: a peer's key can land
 * while we are still inside `room.connect()`, and a relay replay of that
 * same wrap must still be able to reach the session that registers next.
 */
export function deliverMediaKey(
  senderPubkey: string,
  envelope: DMMediaKeyEnvelope,
  wrapId: string,
): boolean {
  if (seenWrapIds.has(wrapId)) return false;
  if (!receiver) return false;
  seenWrapIds.set(wrapId, true);
  receiver(senderPubkey, envelope);
  return true;
}

/** Test hook. */
export function resetMediaKeyInbox(): void {
  receiver = null;
  seenWrapIds.clear();
}
