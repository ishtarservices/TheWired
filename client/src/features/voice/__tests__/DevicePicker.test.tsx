/**
 * The in-call "Let voices overlap" switch.
 *
 * Nothing in the app lowers one speaker for another: the dip people hear
 * comes from each sender's own echo canceller pulling the mic down while
 * remote audio plays. The switch is the in-call face of that one setting,
 * so it must stay the exact inverse of "Echo cancellation" in Settings.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DevicePicker } from "../devices/DevicePicker";
import { DeviceMenuButton } from "../devices/DeviceMenuButton";
import { enumerateDevices } from "@/lib/webrtc/mediaDevices";
import { getMediaPrefs, setMediaPrefs, __resetMediaPrefsForTests } from "@/lib/webrtc/mediaPrefs";

beforeEach(() => {
  __resetMediaPrefsForTests();
});

describe("Let voices overlap", () => {
  it("is off by default and turns echo cancellation off when switched on", () => {
    render(<DevicePicker compact showOverlap />);
    const toggle = screen.getByRole("switch", { name: "Let voices overlap" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(getMediaPrefs().echoCancellation).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(getMediaPrefs().echoCancellation).toBe(true);
  });

  it("mirrors the Settings toggle: one preference, two faces", () => {
    setMediaPrefs({ echoCancellation: false });
    render(<DevicePicker showOverlap showProcessing />);
    expect(screen.getByRole("switch", { name: "Let voices overlap" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Echo cancellation" }).getAttribute("aria-checked")).toBe("false");
  });

  it("is not shown where it was not asked for", () => {
    render(<DevicePicker showProcessing />);
    expect(screen.queryByRole("switch", { name: "Let voices overlap" })).toBeNull();
  });
});

/**
 * pre-fix: the gear button kept its picker mounted inside the closed popover.
 * The picker enumerates devices on mount and, when their names are not
 * readable yet, opens the mic and the camera for an instant to get them — so
 * that happened the moment a call or channel appeared, racing the call's own
 * microphone start, and it lit the camera in audio-only calls.
 */
describe("device menu", () => {
  it("does not mount the picker (or touch any device) until it is opened", () => {
    render(<DeviceMenuButton />);
    expect(screen.queryByRole("switch", { name: "Let voices overlap" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Audio & video devices" }));
    expect(screen.getByRole("switch", { name: "Let voices overlap" })).toBeTruthy();
  });

  it("never probes the camera for a caller that does not list cameras", async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    const unlabelled = [
      { kind: "audioinput", deviceId: "m", label: "" },
      { kind: "videoinput", deviceId: "c", label: "" },
    ];
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia, enumerateDevices: async () => unlabelled },
    });
    try {
      await enumerateDevices({ video: false });
      expect(getUserMedia.mock.calls.map((c) => Object.keys((c as unknown[])[0] as object)[0])).toEqual(["audio"]);
      getUserMedia.mockClear();
      await enumerateDevices();
      expect(getUserMedia.mock.calls.map((c) => Object.keys((c as unknown[])[0] as object)[0])).toEqual(["audio", "video"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
