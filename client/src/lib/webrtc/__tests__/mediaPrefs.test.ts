/**
 * Media preference persistence.
 *
 * pre-fix: no device selection existed — every join captured from the OS
 * "Default" endpoint (on Windows often not the headset).
 * post-fix asserts: choices persist across a simulated relaunch, listeners
 * fire only on real changes, per-participant volume/mute round-trips and
 * collapses back to the default row when reset.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getMediaPrefs,
  setMediaPrefs,
  subscribeMediaPrefs,
  audioProcessingChanged,
  getParticipantAudio,
  setParticipantAudio,
  subscribeParticipantAudio,
  DEFAULT_PARTICIPANT_AUDIO,
  __resetMediaPrefsForTests,
  __reloadMediaPrefsForTests,
} from "../mediaPrefs";

beforeEach(() => {
  __resetMediaPrefsForTests();
});

describe("device prefs", () => {
  it("defaults to system devices with processing on", () => {
    const p = getMediaPrefs();
    expect(p.audioInput).toBeNull();
    expect(p.audioOutput).toBeNull();
    expect(p.videoInput).toBeNull();
    expect(p.echoCancellation).toBe(true);
    expect(p.noiseSuppression).toBe(true);
    expect(p.autoGainControl).toBe(true);
  });

  it("persists across a relaunch", () => {
    setMediaPrefs({ audioInput: "mic-2", autoGainControl: false });
    __reloadMediaPrefsForTests();
    expect(getMediaPrefs().audioInput).toBe("mic-2");
    expect(getMediaPrefs().autoGainControl).toBe(false);
    expect(getMediaPrefs().noiseSuppression).toBe(true);
  });

  it("notifies with next+prev only when something changed", () => {
    const fn = vi.fn();
    const off = subscribeMediaPrefs(fn);
    setMediaPrefs({ audioInput: "mic-1" });
    setMediaPrefs({ audioInput: "mic-1" }); // identical → no event
    expect(fn).toHaveBeenCalledTimes(1);
    const [next, prev] = fn.mock.calls[0];
    expect(next.audioInput).toBe("mic-1");
    expect(prev.audioInput).toBeNull();
    off();
    setMediaPrefs({ audioInput: "mic-3" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("audioProcessingChanged ignores device-only changes", () => {
    const a = getMediaPrefs();
    const b = setMediaPrefs({ audioInput: "x" });
    expect(audioProcessingChanged(a, b)).toBe(false);
    const c = setMediaPrefs({ noiseSuppression: false });
    expect(audioProcessingChanged(b, c)).toBe(true);
  });
});

describe("participant audio", () => {
  const PK = "a".repeat(64);

  it("defaults to full volume, unmuted (shared default object)", () => {
    expect(getParticipantAudio(PK)).toBe(DEFAULT_PARTICIPANT_AUDIO);
  });

  it("stores volume + mute, clamps, and persists", () => {
    setParticipantAudio(PK, { volume: 1.7 });
    expect(getParticipantAudio(PK).volume).toBe(1);
    setParticipantAudio(PK, { volume: 0.35, muted: true });
    __reloadMediaPrefsForTests();
    expect(getParticipantAudio(PK)).toEqual({ volume: 0.35, muted: true });
  });

  it("returns to the default row when reset to 100% unmuted", () => {
    setParticipantAudio(PK, { volume: 0.5 });
    setParticipantAudio(PK, { volume: 1 });
    expect(getParticipantAudio(PK)).toBe(DEFAULT_PARTICIPANT_AUDIO);
  });

  it("notifies per pubkey", () => {
    const fn = vi.fn();
    subscribeParticipantAudio(fn);
    setParticipantAudio(PK, { muted: true });
    expect(fn).toHaveBeenCalledWith(PK, { volume: 1, muted: true });
  });
});
