/**
 * A way for feature code to say "these events were dropped on purpose; let
 * them be delivered again" without importing the event pipeline.
 *
 * The pipeline keeps an LRU of every event id it has processed and ignores a
 * repeat. That is right for a relay re-sending something, and wrong once a
 * feature has removed the event from the store deliberately: the re-fetch
 * would be swallowed for the rest of the session. The pipeline imports most of
 * the app, so features reach it through this registry instead of importing it
 * back (which would be a cycle).
 */
type Forget = (ids: readonly string[]) => void;

let forget: Forget | null = null;

/** Called once by the event pipeline with its dedup un-marker. */
export function registerForgetSeen(fn: Forget): void {
  forget = fn;
}

/** Un-mark event ids so a later delivery is processed again. A no-op before
 *  the pipeline has registered (nothing has been seen yet). */
export function forgetSeenEvents(ids: readonly string[]): void {
  if (ids.length > 0) forget?.(ids);
}
