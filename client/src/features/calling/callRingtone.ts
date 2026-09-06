/**
 * Synthesized call sounds (incoming ring, outgoing ringback, hangup,
 * join/leave). Web Audio tones — no audio assets yet.
 *
 * All sounds use the shared, gesture-unlocked AudioContext from
 * `lib/audio/unlockAudio` so they are audible on Windows WebView2, where a
 * context created outside a user gesture stays suspended (silent ringtone).
 * Every function is a no-op where Web Audio is unavailable (jsdom).
 */
import { getSharedAudioContext } from "@/lib/audio/unlockAudio";

let ringInterval: ReturnType<typeof setInterval> | null = null;
let ringbackInterval: ReturnType<typeof setInterval> | null = null;

/** Play one sine tone. `freqEnd` sweeps the pitch over the duration. */
function tone(opts: {
  freq: number;
  freqEnd?: number;
  duration: number;
  gain: number;
  delayMs?: number;
}): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const play = () => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = opts.freq;
    if (opts.freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, ctx.currentTime + opts.duration);
    }
    g.gain.value = opts.gain;
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + opts.duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + opts.duration);
  };
  if (opts.delayMs) setTimeout(play, opts.delayMs);
  else play();
}

/** Incoming-call ring: two-note burst every 3s. */
export function startRinging(): void {
  stopRinging();
  const burst = () => {
    tone({ freq: 440, duration: 0.5, gain: 0.1 });
    tone({ freq: 554, duration: 0.5, gain: 0.1, delayMs: 200 });
  };
  burst();
  ringInterval = setInterval(burst, 3000);
}

export function stopRinging(): void {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
}

/**
 * Outgoing-call ringback: a single low tone, 1s on / 3s off, so the caller
 * hears that the invite is out and the other side is being rung. Quieter
 * than the incoming ring — it plays through the caller's own speakers.
 */
export function startRingback(): void {
  stopRingback();
  const pulse = () => tone({ freq: 425, duration: 1.0, gain: 0.05 });
  pulse();
  ringbackInterval = setInterval(pulse, 4000);
}

export function stopRingback(): void {
  if (ringbackInterval) {
    clearInterval(ringbackInterval);
    ringbackInterval = null;
  }
}

/** Call ended: descending tone. */
export function playCallEnd(): void {
  tone({ freq: 440, freqEnd: 220, duration: 0.3, gain: 0.1 });
}

/** Someone joined: ascending tone. */
export function playJoinSound(): void {
  tone({ freq: 330, freqEnd: 440, duration: 0.2, gain: 0.08 });
}

/** Someone left: descending tone. */
export function playLeaveSound(): void {
  tone({ freq: 440, freqEnd: 330, duration: 0.2, gain: 0.08 });
}
