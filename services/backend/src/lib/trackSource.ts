import { TrackSource } from "@livekit/protocol";

/** Client-facing track source names → LiveKit's numeric `TrackSource` enum. */
export const TRACK_SOURCE_MAP: Record<string, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

/**
 * Does a LiveKit track belong to the client-named source?
 *
 * `ParticipantInfo.tracks[].source` from the room service is the numeric
 * protobuf enum (CAMERA = 1, MICROPHONE = 2, …), never the lowercase name the
 * moderation routes receive, so a plain `===` against "microphone" matched
 * nothing and every moderator mute 404'd. The enum's protobuf name
 * ("MICROPHONE") and the client name are accepted too, since the SDK's JSON
 * shape has carried either over time.
 */
export function trackMatchesSource(source: unknown, name: string): boolean {
  const expected = TRACK_SOURCE_MAP[name];
  if (expected === undefined) return false;
  if (typeof source === "number") return source === expected;
  if (typeof source === "string") {
    if (source === name) return true;
    if (source === String(expected)) return true;
    return source.toUpperCase() === TrackSource[expected];
  }
  return false;
}
