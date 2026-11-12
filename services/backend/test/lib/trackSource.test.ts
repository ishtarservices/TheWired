import { describe, it, expect } from "vitest";
import { TrackSource } from "@livekit/protocol";
import { trackMatchesSource } from "../../src/lib/trackSource.js";

/** /voice/mute looks a participant's track up by the client's source name;
 *  LiveKit reports the numeric enum, so a string compare never matched. */
describe("trackMatchesSource", () => {
  it("matches the numeric TrackSource enum the room service returns", () => {
    expect(trackMatchesSource(TrackSource.MICROPHONE, "microphone")).toBe(true);
    expect(trackMatchesSource(TrackSource.CAMERA, "camera")).toBe(true);
    expect(trackMatchesSource(TrackSource.CAMERA, "microphone")).toBe(false);
    expect(trackMatchesSource(TrackSource.SCREEN_SHARE, "microphone")).toBe(false);
  });

  it("accepts the protobuf name and the client name too", () => {
    expect(trackMatchesSource("MICROPHONE", "microphone")).toBe(true);
    expect(trackMatchesSource("microphone", "microphone")).toBe(true);
    expect(trackMatchesSource(String(TrackSource.MICROPHONE), "microphone")).toBe(true);
    expect(trackMatchesSource("CAMERA", "microphone")).toBe(false);
  });

  it("never matches an unknown source name or a malformed track", () => {
    expect(trackMatchesSource(TrackSource.MICROPHONE, "speaker")).toBe(false);
    expect(trackMatchesSource(undefined, "microphone")).toBe(false);
    expect(trackMatchesSource(null, "microphone")).toBe(false);
    expect(trackMatchesSource({}, "microphone")).toBe(false);
  });
});
