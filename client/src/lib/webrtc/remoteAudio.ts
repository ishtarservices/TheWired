/**
 * Remote audio playback registry for LiveKit rooms.
 *
 * A LiveKit remote audio track produces NO sound until it is attached to an
 * HTMLAudioElement. Speaking indicators (ActiveSpeakersChanged) come from the
 * server data layer and fire regardless, so a missing attach looks like
 * "green speaking rings but silence" (audit #7).
 *
 * This is a manual track.attach() registry on purpose — NOT LiveKit's
 * <RoomAudioRenderer>. RoomAudioRenderer would statically import
 * livekit-client (+ @livekit/components-core) into the always-mounted tree,
 * defeating the planned lazy-load of the SDK (#54). Do not "simplify" back
 * to it.
 *
 * Per-participant volume/local-mute (mediaPrefs) and the global deafen flag
 * are applied here, to current AND late-attached elements, and re-asserted
 * whenever something else changes an element behind our back.
 *
 * Elements are also watched for `pause`: a WebView can pause a live element
 * on an audio-route change or interruption and never resume it, which is one
 * participant going silent for good while their speaking ring keeps moving.
 *
 * livekit imports here must stay type-only so this module never drags the
 * SDK into a bundle chunk by itself.
 */
import type { Track } from "livekit-client";
import { createLogger } from "../debug/logger";
import {
  getParticipantAudio,
  subscribeParticipantAudio,
  DEFAULT_PARTICIPANT_AUDIO,
} from "./mediaPrefs";

const log = createLogger("call");

interface Attached {
  el: HTMLAudioElement;
  /** Publishing participant (pubkey) — null for tracks attached without one. */
  identity: string | null;
  /** When we last called `play()` on a paused element (0 = never). */
  lastResumeAt: number;
}

/** Attached audio elements keyed by track. */
const attached = new Map<Track, Attached>();

/** Output-mute flag (deafen). Applies to current AND late-attached tracks. */
let outputMuted = false;

/** Room-wide voice volume 0..1 (the Listen Together music/voice balance),
 *  multiplied into every participant's own volume. */
let outputVolume = 1;

/** Called when a paused element could not be resumed without a gesture. */
let onPlaybackBlocked: (() => void) | null = null;

/**
 * Register the "playback needs a user gesture" hook (livekitClient raises
 * the same "Enable audio" pill the SDK's own autoplay detection does).
 * Kept as a hook so this module stays free of the store and the SDK.
 */
export function setRemoteAudioBlockedHandler(fn: (() => void) | null): void {
  onPlaybackBlocked = fn;
}

/** Minimum gap between automatic resume attempts on one element. */
const RESUME_RETRY_MS = 1000;

function applyState(entry: Attached): void {
  const p = entry.identity ? getParticipantAudio(entry.identity) : DEFAULT_PARTICIPANT_AUDIO;
  const muted = outputMuted || p.muted;
  // Assign only on a real difference: `volumechange` re-enters here, and a
  // platform that ignores `volume` (iOS) must not turn that into a loop.
  if (entry.el.muted !== muted) entry.el.muted = muted;
  const volume = p.volume * outputVolume;
  if (Math.abs(entry.el.volume - volume) > 0.001) entry.el.volume = volume;
}

/** `play()` an attached element; a rejection means a gesture is required. */
function resumeElement(track: Track, entry: Attached): void {
  entry.lastResumeAt = Date.now();
  let result: Promise<void> | undefined;
  try {
    result = entry.el.play();
  } catch {
    return;
  }
  result?.catch((err: unknown) => {
    if (attached.get(track) !== entry) return;
    log.warn("remote audio could not resume on its own", err);
    onPlaybackBlocked?.();
  });
}

function watchElement(track: Track, entry: Attached): void {
  // LiveKit's `startAudio()` unmutes every attached element, and it runs on
  // its own each time the local mic stream is (re)acquired (join, device
  // switch, processing change). Without this a deafened user, or one who
  // muted a single participant, started hearing them again.
  entry.el.addEventListener("volumechange", () => {
    if (attached.get(track) === entry) applyState(entry);
  });
  entry.el.addEventListener("pause", () => {
    // Detach removes the entry first, so a pause seen here is unwanted.
    if (attached.get(track) !== entry) return;
    if (Date.now() - entry.lastResumeAt < RESUME_RETRY_MS) {
      // Paused again right after we resumed it: stop fighting, ask the user.
      onPlaybackBlocked?.();
      return;
    }
    log.warn("remote audio element was paused by the WebView, resuming");
    resumeElement(track, entry);
  });
}

subscribeParticipantAudio((pubkey) => {
  for (const entry of attached.values()) {
    if (entry.identity === pubkey) applyState(entry);
  }
});

/**
 * Attach a remote audio track to a hidden <audio> element so it actually
 * plays. Covers Microphone and ScreenShareAudio sources — anything with
 * kind "audio". Non-audio tracks are ignored. Idempotent per track.
 */
export function attachRemoteAudio(track: Track, identity?: string): void {
  if (track.kind !== "audio") return;
  if (attached.has(track)) return;

  // track.attach() creates the element and calls play(); if autoplay is
  // blocked the room fires AudioPlaybackStatusChanged and room.startAudio()
  // (user gesture) retries every attached element.
  const el = track.attach() as HTMLAudioElement;
  // Keep the element in the DOM — some WebViews won't play detached elements.
  el.style.display = "none";
  document.body.appendChild(el);
  const entry: Attached = { el, identity: identity ?? null, lastResumeAt: 0 };
  applyState(entry);
  attached.set(track, entry);
  watchElement(track, entry);
  log.debug(`remote audio attached (${attached.size} total, outputMuted=${outputMuted})`);
}

/** Detach and remove the element for a track (on unsubscribe). */
export function detachRemoteAudio(track: Track): void {
  const entry = attached.get(track);
  if (!entry) return;
  // Forget the entry first: tearing the element down fires `pause`, which
  // the watcher must read as expected, not as something to resume.
  attached.delete(track);
  track.detach(entry.el);
  entry.el.remove();
  log.debug(`remote audio detached (${attached.size} remain)`);
}

/**
 * Resume every attached element that is paused. Call from a user gesture
 * (the "Enable audio" pill) so the WebView's autoplay policy allows it.
 */
export function resumeRemoteAudio(): void {
  for (const [track, entry] of attached) {
    if (entry.el.paused) resumeElement(track, entry);
  }
}

/**
 * Mute/unmute ALL remote audio output (deafen). The flag persists so tracks
 * attached later (late joiners) start in the right state.
 */
export function setRemoteAudioOutputMuted(muted: boolean): void {
  outputMuted = muted;
  for (const entry of attached.values()) applyState(entry);
}

export function isRemoteAudioOutputMuted(): boolean {
  return outputMuted;
}

/**
 * Volume of ALL remote voices, 0..1, on top of each participant's own
 * volume. Lives here (not on the elements directly) so it reaches tracks
 * attached later and survives the re-assert that guards deafen.
 */
export function setRemoteAudioOutputVolume(volume: number): void {
  outputVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
  for (const entry of attached.values()) applyState(entry);
}

export function getRemoteAudioOutputVolume(): number {
  return outputVolume;
}

/**
 * Detach everything and reset the output-mute flag and voice volume. Called on room
 * disconnect so the next room starts from a clean state (mirrors
 * voiceSlice.disconnectRoom resetting localState).
 */
export function clearRemoteAudio(): void {
  const entries = [...attached];
  attached.clear();
  for (const [track, entry] of entries) {
    track.detach(entry.el);
    entry.el.remove();
  }
  outputMuted = false;
  outputVolume = 1;
}

/** Number of currently attached audio tracks (diagnostics + tests). */
export function attachedRemoteAudioCount(): number {
  return attached.size;
}

/** Playback state of every attached element (`wiredDebug.calls()`). */
export function remoteAudioDiagnostics(): Array<Record<string, unknown>> {
  return [...attached.values()].map(({ el, identity }) => ({
    participant: identity ? identity.slice(0, 8) : "(unknown)",
    paused: el.paused,
    muted: el.muted,
    volume: el.volume,
    readyState: el.readyState,
  }));
}

/** Elements attached for a participant (diagnostics + tests). */
export function attachedElementsFor(identity: string): HTMLAudioElement[] {
  const out: HTMLAudioElement[] = [];
  for (const entry of attached.values()) {
    if (entry.identity === identity) out.push(entry.el);
  }
  return out;
}
