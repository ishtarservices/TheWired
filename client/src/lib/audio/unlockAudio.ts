/**
 * Shared AudioContext + autoplay unlock.
 *
 * Chromium (Windows WebView2) creates every AudioContext in the "suspended"
 * state until `resume()` is called from inside a user gesture. An incoming
 * call ring happens outside any gesture, so a context created on demand
 * synthesizes silence — the "silent ringtone on Windows" bug.
 *
 * `installAudioUnlock()` (called once from main.tsx) resumes a single shared
 * context on the first pointer/keyboard gesture of the session and removes
 * itself once the context is running. Every synthesized sound (ringtone,
 * ringback, join/leave) goes through `getSharedAudioContext()`.
 */

let ctx: AudioContext | null = null;
let installed = false;

/** The shared context, or null where Web Audio is unavailable (tests). */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") {
    // Works when called inside a gesture; harmless (rejected/no-op) outside.
    void ctx.resume().catch(() => {});
  }
  return ctx;
}

const GESTURE_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export function installAudioUnlock(): void {
  if (installed || typeof window === "undefined" || typeof AudioContext === "undefined") return;
  installed = true;

  const remove = () => {
    for (const ev of GESTURE_EVENTS) window.removeEventListener(ev, onGesture, true);
  };
  const onGesture = () => {
    const c = getSharedAudioContext();
    if (!c) {
      remove();
      return;
    }
    c.resume()
      .then(() => {
        if (c.state === "running") remove();
      })
      .catch(() => {});
  };
  for (const ev of GESTURE_EVENTS) {
    window.addEventListener(ev, onGesture, { capture: true, passive: true });
  }
}

/** Test hook — drop the shared context so a fresh one is created. */
export function __resetSharedAudioContext(): void {
  ctx = null;
  installed = false;
}
