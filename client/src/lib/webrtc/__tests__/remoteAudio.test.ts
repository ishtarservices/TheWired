/**
 * Remote-audio attach registry (audit #7).
 *
 * pre-fix: NOTHING attached remote audio tracks — voice channels and SFU 1:1
 *   calls were silent while speaking indicators kept flashing.
 * post-fix asserts: audio tracks get a playing element exactly once, video
 *   kinds are ignored, the deafen flag covers current AND late tracks, and
 *   room disconnect clears everything back to a clean state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Track } from "livekit-client";
import {
  attachRemoteAudio,
  detachRemoteAudio,
  setRemoteAudioOutputMuted,
  isRemoteAudioOutputMuted,
  clearRemoteAudio,
  attachedRemoteAudioCount,
} from "../remoteAudio";

interface FakeTrack {
  kind: string;
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  el: HTMLAudioElement;
}

function fakeTrack(kind: "audio" | "video"): FakeTrack {
  const el = document.createElement("audio");
  return {
    kind,
    attach: vi.fn(() => el),
    detach: vi.fn(),
    el,
  };
}

const asTrack = (t: FakeTrack) => t as unknown as Track;

beforeEach(() => {
  clearRemoteAudio();
});

describe("remoteAudio registry", () => {
  it("attaches an audio track to an element in the DOM", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t));
    expect(t.attach).toHaveBeenCalledTimes(1);
    expect(attachedRemoteAudioCount()).toBe(1);
    expect(document.body.contains(t.el)).toBe(true);
  });

  it("is idempotent per track", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t));
    attachRemoteAudio(asTrack(t));
    expect(t.attach).toHaveBeenCalledTimes(1);
    expect(attachedRemoteAudioCount()).toBe(1);
  });

  it("ignores non-audio tracks", () => {
    const t = fakeTrack("video");
    attachRemoteAudio(asTrack(t));
    expect(t.attach).not.toHaveBeenCalled();
    expect(attachedRemoteAudioCount()).toBe(0);
  });

  it("detach removes the element and forgets the track", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t));
    detachRemoteAudio(asTrack(t));
    expect(t.detach).toHaveBeenCalledWith(t.el);
    expect(document.body.contains(t.el)).toBe(false);
    expect(attachedRemoteAudioCount()).toBe(0);
  });

  it("output mute applies to already-attached tracks", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t));
    setRemoteAudioOutputMuted(true);
    expect(t.el.muted).toBe(true);
    setRemoteAudioOutputMuted(false);
    expect(t.el.muted).toBe(false);
  });

  it("output mute applies to LATE-attached tracks (late joiners while deafened)", () => {
    setRemoteAudioOutputMuted(true);
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t));
    expect(t.el.muted).toBe(true);
  });

  it("clearRemoteAudio detaches everything and resets the mute flag", () => {
    const a = fakeTrack("audio");
    const b = fakeTrack("audio");
    attachRemoteAudio(asTrack(a));
    attachRemoteAudio(asTrack(b));
    setRemoteAudioOutputMuted(true);

    clearRemoteAudio();

    expect(a.detach).toHaveBeenCalled();
    expect(b.detach).toHaveBeenCalled();
    expect(attachedRemoteAudioCount()).toBe(0);
    // Next room starts clean — mirrors voiceSlice.disconnectRoom
    expect(isRemoteAudioOutputMuted()).toBe(false);
  });
});
