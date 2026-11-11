// Media sessions (voice/video channels, 1:1 calls) belong to the account that
// started them: the LiveKit identity is minted for that account, and the E2EE
// key envelopes are sealed with its signer. When the account changes
// (switch, add, log out), every session must end before the next account
// logs in. If it keeps running, the old account stays on camera with no UI
// left to hang up, and its key manager signs with the new account's key,
// which links the two accounts publicly.
//
// This module has no imports on purpose. `loginFlow` reaches the media layer
// through it without pulling in livekit-client (the SDK stays lazy) or
// creating an import cycle. Modules that own a live session register a
// teardown; joins capture the epoch when they start and give up at their next
// checkpoint once it has moved.

/** Thrown by a join that was overtaken by an account change. Not a failure
 *  to show the user: the call ended on purpose. */
export class MediaSessionAbortedError extends Error {
  constructor() {
    super("The account changed while joining; the join was abandoned.");
    this.name = "MediaSessionAbortedError";
  }
}

export function isMediaSessionAborted(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "MediaSessionAbortedError";
}

let epoch = 0;
const teardowns = new Set<() => void | Promise<void>>();

/** Capture at the start of a join; compare with `isMediaEpochCurrent`. */
export function mediaEpoch(): number {
  return epoch;
}

export function isMediaEpochCurrent(captured: number): boolean {
  return captured === epoch;
}

/** Throws `MediaSessionAbortedError` if an account change happened since `captured`. */
export function assertMediaEpoch(captured: number): void {
  if (captured !== epoch) throw new MediaSessionAbortedError();
}

/** Register how to hard-stop a live session (disconnect the room, clear
 *  timers). Runs on every `abandonMediaSessions`. */
export function onAbandonMediaSessions(fn: () => void | Promise<void>): () => void {
  teardowns.add(fn);
  return () => {
    teardowns.delete(fn);
  };
}

/** Make every join in flight give up at its next checkpoint. Live rooms are
 *  left alone, so the caller can still end them gracefully (presence clear,
 *  "call missed") with the outgoing account's signer. */
export function invalidateMediaJoins(): void {
  epoch++;
}

/**
 * Hard stop: invalidate joins in flight and run every registered teardown.
 * Synchronous to start, so `performCleanup()` (sync) can use it as the
 * backstop. Nothing here signs or publishes. Never rejects.
 */
export function abandonMediaSessions(): Promise<void> {
  epoch++;
  const work = [...teardowns].map((fn) => {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  });
  return Promise.allSettled(work).then(() => undefined);
}
