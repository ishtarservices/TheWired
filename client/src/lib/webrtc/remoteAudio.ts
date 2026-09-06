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
 * are applied here, to current AND late-attached elements.
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
}

/** Attached audio elements keyed by track. */
const attached = new Map<Track, Attached>();

/** Output-mute flag (deafen). Applies to current AND late-attached tracks. */
let outputMuted = false;

function applyState(entry: Attached): void {
  const p = entry.identity ? getParticipantAudio(entry.identity) : DEFAULT_PARTICIPANT_AUDIO;
  entry.el.muted = outputMuted || p.muted;
  entry.el.volume = p.volume;
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
  const entry: Attached = { el, identity: identity ?? null };
  applyState(entry);
  attached.set(track, entry);
  log.debug(`remote audio attached (${attached.size} total, outputMuted=${outputMuted})`);
}

/** Detach and remove the element for a track (on unsubscribe). */
export function detachRemoteAudio(track: Track): void {
  const entry = attached.get(track);
  if (!entry) return;
  track.detach(entry.el);
  entry.el.remove();
  attached.delete(track);
  log.debug(`remote audio detached (${attached.size} remain)`);
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
 * Detach everything and reset the output-mute flag. Called on room
 * disconnect so the next room starts from a clean state (mirrors
 * voiceSlice.disconnectRoom resetting localState).
 */
export function clearRemoteAudio(): void {
  for (const [track, entry] of attached) {
    track.detach(entry.el);
    entry.el.remove();
  }
  attached.clear();
  outputMuted = false;
}

/** Number of currently attached audio tracks (diagnostics + tests). */
export function attachedRemoteAudioCount(): number {
  return attached.size;
}

/** Elements attached for a participant (diagnostics + tests). */
export function attachedElementsFor(identity: string): HTMLAudioElement[] {
  const out: HTMLAudioElement[] = [];
  for (const entry of attached.values()) {
    if (entry.identity === identity) out.push(entry.el);
  }
  return out;
}
