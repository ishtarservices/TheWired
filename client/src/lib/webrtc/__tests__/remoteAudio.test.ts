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
  attachedElementsFor,
  resumeRemoteAudio,
  setRemoteAudioBlockedHandler,
  setRemoteAudioOutputVolume,
  getRemoteAudioOutputVolume,
} from "../remoteAudio";
import { setParticipantAudio, __resetMediaPrefsForTests } from "../mediaPrefs";

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

describe("per-participant volume / local mute", () => {
  const PK = "a".repeat(64);

  beforeEach(() => {
    __resetMediaPrefsForTests();
    clearRemoteAudio();
  });

  it("applies a stored volume + mute to a late-attached track", () => {
    setParticipantAudio(PK, { volume: 0.4, muted: true });
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t), PK);
    expect(t.el.volume).toBeCloseTo(0.4);
    expect(t.el.muted).toBe(true);
  });

  it("live changes reach already-attached elements of that participant only", () => {
    const a = fakeTrack("audio");
    const b = fakeTrack("audio");
    attachRemoteAudio(asTrack(a), PK);
    attachRemoteAudio(asTrack(b), "b".repeat(64));
    setParticipantAudio(PK, { volume: 0.25 });
    expect(a.el.volume).toBeCloseTo(0.25);
    expect(b.el.volume).toBe(1);
  });

  it("deafen wins over a participant unmute; undeafen restores the local mute", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t), PK);
    setRemoteAudioOutputMuted(true);
    setParticipantAudio(PK, { muted: false });
    expect(t.el.muted).toBe(true);
    setParticipantAudio(PK, { muted: true });
    setRemoteAudioOutputMuted(false);
    expect(t.el.muted).toBe(true);
    setParticipantAudio(PK, { muted: false });
    expect(t.el.muted).toBe(false);
  });

  it("attachedElementsFor lists a participant's elements", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t), PK);
    expect(attachedElementsFor(PK)).toEqual([t.el]);
    expect(attachedElementsFor("c".repeat(64))).toEqual([]);
  });
});

/**
 * pre-fix: LiveKit's `startAudio()` sets `muted = false` on every attached
 * element, and the SDK calls it by itself each time the local mic stream is
 * (re)acquired — so switching input device while deafened, or with one
 * participant muted locally, made them audible again. And an element the
 * WebView paused (audio-route change, interruption) stayed paused: that
 * participant was silent until they republished.
 */
describe("elements changed behind our back", () => {
  const PK = "b".repeat(64);

  beforeEach(() => {
    __resetMediaPrefsForTests();
    clearRemoteAudio();
    setRemoteAudioBlockedHandler(null);
  });

  it("deafen survives something else unmuting the element", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t), PK);
    setRemoteAudioOutputMuted(true);
    t.el.muted = false; // what room.startAudio() does
    t.el.dispatchEvent(new Event("volumechange"));
    expect(t.el.muted).toBe(true);
  });

  it("a per-participant local mute and volume survive it too", () => {
    setParticipantAudio(PK, { volume: 0.25, muted: true });
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t), PK);
    t.el.muted = false;
    t.el.volume = 1;
    t.el.dispatchEvent(new Event("volumechange"));
    expect(t.el.muted).toBe(true);
    expect(t.el.volume).toBeCloseTo(0.25);
  });

  it("an element paused while attached is resumed", () => {
    const t = fakeTrack("audio");
    const play = vi.fn(async () => {});
    t.el.play = play;
    attachRemoteAudio(asTrack(t), PK);
    t.el.dispatchEvent(new Event("pause"));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("the pause that comes with a detach is left alone", () => {
    const t = fakeTrack("audio");
    const play = vi.fn(async () => {});
    t.el.play = play;
    attachRemoteAudio(asTrack(t), PK);
    detachRemoteAudio(asTrack(t));
    t.el.dispatchEvent(new Event("pause"));
    expect(play).not.toHaveBeenCalled();
  });

  it("asks for a gesture when resuming is refused, and when the element is paused again at once", async () => {
    const blocked = vi.fn();
    setRemoteAudioBlockedHandler(blocked);
    const refused = fakeTrack("audio");
    refused.el.play = vi.fn(async () => {
      throw Object.assign(new Error("gesture required"), { name: "NotAllowedError" });
    });
    attachRemoteAudio(asTrack(refused), PK);
    refused.el.dispatchEvent(new Event("pause"));
    await Promise.resolve();
    await Promise.resolve();
    expect(blocked).toHaveBeenCalledTimes(1);

    // Resumed fine, but the WebView pauses it again straight away: no loop.
    const flapping = fakeTrack("audio");
    const play = vi.fn(async () => {});
    flapping.el.play = play;
    attachRemoteAudio(asTrack(flapping), PK);
    flapping.el.dispatchEvent(new Event("pause"));
    flapping.el.dispatchEvent(new Event("pause"));
    expect(play).toHaveBeenCalledTimes(1);
    expect(blocked).toHaveBeenCalledTimes(2);
  });

  it("resumeRemoteAudio plays only the elements that are paused", () => {
    const paused = fakeTrack("audio");
    const playing = fakeTrack("audio");
    const playPaused = vi.fn(async () => {});
    const playPlaying = vi.fn(async () => {});
    paused.el.play = playPaused;
    playing.el.play = playPlaying;
    Object.defineProperty(playing.el, "paused", { get: () => false });
    attachRemoteAudio(asTrack(paused), PK);
    attachRemoteAudio(asTrack(playing), PK);
    resumeRemoteAudio();
    expect(playPaused).toHaveBeenCalledTimes(1);
    expect(playPlaying).not.toHaveBeenCalled();
  });
});

/**
 * The Listen Together music/voice balance. pre-fix it wrote `el.volume` on
 * whatever elements existed at that moment: people who joined later played
 * at full volume, and it overwrote each participant's own volume.
 */
describe("room-wide voice volume", () => {
  const PK = "c".repeat(64);

  beforeEach(() => {
    __resetMediaPrefsForTests();
    clearRemoteAudio();
  });

  it("scales every voice, keeps per-participant volumes in proportion, and reaches late joiners", () => {
    setParticipantAudio(PK, { volume: 0.5 });
    const quiet = fakeTrack("audio");
    const normal = fakeTrack("audio");
    attachRemoteAudio(asTrack(quiet), PK);
    attachRemoteAudio(asTrack(normal));
    setRemoteAudioOutputVolume(0.4);
    expect(quiet.el.volume).toBeCloseTo(0.2);
    expect(normal.el.volume).toBeCloseTo(0.4);
    const late = fakeTrack("audio");
    attachRemoteAudio(asTrack(late));
    expect(late.el.volume).toBeCloseTo(0.4);
  });

  it("survives the element being reset, and goes back to full for the next room", () => {
    const t = fakeTrack("audio");
    attachRemoteAudio(asTrack(t));
    setRemoteAudioOutputVolume(0.3);
    t.el.volume = 1;
    t.el.dispatchEvent(new Event("volumechange"));
    expect(t.el.volume).toBeCloseTo(0.3);
    clearRemoteAudio();
    expect(getRemoteAudioOutputVolume()).toBe(1);
  });
});
