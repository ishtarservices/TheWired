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
 * defeating the planned lazy-load of the SDK (#54), and it cannot cover the
 * P2P 1:1 call path anyway. Do not "simplify" back to it.
 *
 * livekit imports here must stay type-only so this module never drags the
 * SDK into a bundle chunk by itself.
 */
import type { Track } from "livekit-client";
import { createLogger } from "../debug/logger";

const log = createLogger("call");

/** Attached audio elements keyed by track. */
const attached = new Map<Track, HTMLAudioElement>();

/** Output-mute flag (deafen). Applies to current AND late-attached tracks. */
let outputMuted = false;

/**
 * Attach a remote audio track to a hidden <audio> element so it actually
 * plays. Covers Microphone and ScreenShareAudio sources — anything with
 * kind "audio". Non-audio tracks are ignored. Idempotent per track.
 */
export function attachRemoteAudio(track: Track): void {
  if (track.kind !== "audio") return;
  if (attached.has(track)) return;

  // track.attach() creates the element and calls play(); if autoplay is
  // blocked the room fires AudioPlaybackStatusChanged and room.startAudio()
  // (user gesture) retries every attached element.
  const el = track.attach() as HTMLAudioElement;
  el.muted = outputMuted;
  // Keep the element in the DOM — some WebViews won't play detached elements.
  el.style.display = "none";
  document.body.appendChild(el);
  attached.set(track, el);
  log.debug(`remote audio attached (${attached.size} total, outputMuted=${outputMuted})`);
}

/** Detach and remove the element for a track (on unsubscribe). */
export function detachRemoteAudio(track: Track): void {
  const el = attached.get(track);
  if (!el) return;
  track.detach(el);
  el.remove();
  attached.delete(track);
  log.debug(`remote audio detached (${attached.size} remain)`);
}

/**
 * Mute/unmute ALL remote audio output (deafen). The flag persists so tracks
 * attached later (late joiners) start in the right state.
 */
export function setRemoteAudioOutputMuted(muted: boolean): void {
  outputMuted = muted;
  for (const el of attached.values()) {
    el.muted = muted;
  }
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
  for (const [track, el] of attached) {
    track.detach(el);
    el.remove();
  }
  attached.clear();
  outputMuted = false;
}

/** Number of currently attached audio tracks (diagnostics + tests). */
export function attachedRemoteAudioCount(): number {
  return attached.size;
}
