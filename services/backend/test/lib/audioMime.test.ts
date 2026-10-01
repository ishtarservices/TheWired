import { describe, it, expect } from "vitest";
import { canonicalAudioType, ALLOWED_AUDIO_TYPES } from "../../src/lib/audioMime.js";

describe("canonicalAudioType", () => {
  it("maps the iOS .m4a spellings to audio/mp4", () => {
    expect(canonicalAudioType("audio/x-m4a")).toBe("audio/mp4");
    expect(canonicalAudioType("audio/m4a")).toBe("audio/mp4");
    expect(canonicalAudioType("audio/mp4a-latm")).toBe("audio/mp4");
  });

  it("maps other platform aliases to their canonical type", () => {
    expect(canonicalAudioType("audio/x-flac")).toBe("audio/flac");
    expect(canonicalAudioType("audio/wave")).toBe("audio/wav");
    expect(canonicalAudioType("audio/vnd.wave")).toBe("audio/wav");
    expect(canonicalAudioType("audio/x-aac")).toBe("audio/aac");
    expect(canonicalAudioType("audio/x-mp3")).toBe("audio/mpeg");
    expect(canonicalAudioType("application/ogg")).toBe("audio/ogg");
  });

  it("passes every allowlisted type through unchanged", () => {
    for (const t of ALLOWED_AUDIO_TYPES) expect(canonicalAudioType(t)).toBe(t);
  });

  it("ignores case and parameters", () => {
    expect(canonicalAudioType("Audio/MP4; codecs=mp4a.40.2")).toBe("audio/mp4");
    expect(canonicalAudioType(" audio/X-M4A ")).toBe("audio/mp4");
  });

  it("rejects anything that is not an accepted audio type", () => {
    for (const t of ["application/x-bogus", "video/mp4", "image/png", "text/plain", "audio/midi", "", undefined, null]) {
      expect(canonicalAudioType(t)).toBeNull();
    }
  });
});
