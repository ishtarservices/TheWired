/**
 * Deafen/mute state-machine semantics (audit #7/#8).
 *
 * pre-fix: toggleDeafen forced muted=true with no memory — un-deafening left
 *   the UI showing muted while the mic state had never actually been applied.
 * post-fix asserts: deafen remembers and restores the prior mute state, and
 *   unmuting while deafened also un-deafens (the user expects to hear again).
 */
import { describe, it, expect } from "vitest";
import {
  voiceSlice,
  toggleMute,
  toggleDeafen,
  setAudioPlaybackBlocked,
  setConnectedRoom,
  disconnectRoom,
} from "../voiceSlice";

const reducer = voiceSlice.reducer;
const initial = () => reducer(undefined, { type: "@@INIT" });

describe("voiceSlice deafen/mute semantics", () => {
  it("deafening also mutes", () => {
    const s = reducer(initial(), toggleDeafen());
    expect(s.localState.deafened).toBe(true);
    expect(s.localState.muted).toBe(true);
  });

  it("un-deafening restores the prior UNMUTED state", () => {
    let s = initial();
    s = reducer(s, toggleDeafen());
    s = reducer(s, toggleDeafen());
    expect(s.localState.deafened).toBe(false);
    expect(s.localState.muted).toBe(false);
  });

  it("un-deafening restores the prior MUTED state", () => {
    let s = initial();
    s = reducer(s, toggleMute()); // user muted themselves first
    s = reducer(s, toggleDeafen());
    s = reducer(s, toggleDeafen());
    expect(s.localState.deafened).toBe(false);
    expect(s.localState.muted).toBe(true); // still muted, as before deafen
  });

  it("unmuting while deafened also un-deafens", () => {
    let s = initial();
    s = reducer(s, toggleDeafen()); // deafened + muted
    s = reducer(s, toggleMute()); // user clicks unmute
    expect(s.localState.muted).toBe(false);
    expect(s.localState.deafened).toBe(false);
  });

  it("toggleDeafen is symmetric (optimistic-revert safe)", () => {
    let s = initial();
    s = reducer(s, toggleMute());
    const before = s.localState;
    s = reducer(s, toggleDeafen());
    s = reducer(s, toggleDeafen()); // revert path in useVoiceChannel
    expect(s.localState.muted).toBe(before.muted);
    expect(s.localState.deafened).toBe(before.deafened);
  });
});

describe("voiceSlice audio playback blocked flag", () => {
  it("sets and clears the flag", () => {
    let s = reducer(initial(), setAudioPlaybackBlocked(true));
    expect(s.audioPlaybackBlocked).toBe(true);
    s = reducer(s, setAudioPlaybackBlocked(false));
    expect(s.audioPlaybackBlocked).toBe(false);
  });

  it("resets on room disconnect", () => {
    let s = reducer(
      initial(),
      setConnectedRoom({
        room: { spaceId: "sp", channelId: "ch", roomName: "r" },
        token: "t",
        serverUrl: "wss://x",
      }),
    );
    s = reducer(s, setAudioPlaybackBlocked(true));
    s = reducer(s, disconnectRoom());
    expect(s.audioPlaybackBlocked).toBe(false);
  });
});
