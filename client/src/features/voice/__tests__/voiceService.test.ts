/**
 * Voice-channel join under mandatory E2EE (docs/E2EE_CALLS.md):
 * unsupported WebView → blocked before any token; supported → the room is
 * joined with the channel key context; 409 E2EE_REQUIRED → readable error.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  e2eeSupported: true,
  connectRoom: vi.fn(async (_url: string, _token: string, _opts?: unknown) => ({})),
  fetchToken: vi.fn(async (_s: string, _c: string) => ({ token: "t", url: "wss://x", roomName: "s:c" })),
}));

vi.mock("@/lib/webrtc/e2ee/session", () => ({
  e2eeSupported: () => h.e2eeSupported,
  E2EEUnsupportedError: class E2EEUnsupportedError extends Error {
    constructor() {
      super("End-to-end encrypted calls aren't supported on this device");
      this.name = "E2EEUnsupportedError";
    }
  },
}));
vi.mock("@/lib/webrtc/livekitClient", () => ({
  connectToRoom: (...a: [string, string, unknown]) => h.connectRoom(...a),
  disconnectFromRoom: vi.fn(async () => {}),
  setMicrophoneEnabled: vi.fn(async () => {}),
  setCameraEnabled: vi.fn(async () => {}),
  setScreenShareEnabled: vi.fn(async () => {}),
}));
vi.mock("@/lib/webrtc/remoteAudio", () => ({ setRemoteAudioOutputMuted: vi.fn() }));
vi.mock("@/lib/api/voice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/voice")>()),
  fetchVoiceToken: (s: string, c: string) => h.fetchToken(s, c),
}));
vi.mock("@/lib/api/client", () => ({ api: vi.fn(async () => ({ data: {} })) }));
vi.mock("@/lib/nostr/roomPresence", () => ({
  publishRoomPresence: vi.fn(async () => {}),
  clearRoomPresence: vi.fn(async () => {}),
}));

import { joinVoiceChannel } from "../voiceService";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";

const ME = "f".repeat(64);

beforeEach(() => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
  h.e2eeSupported = true;
  h.connectRoom.mockClear();
  h.fetchToken.mockClear();
});

describe("joinVoiceChannel", () => {
  it("joins with the channel E2EE context", async () => {
    await joinVoiceChannel("s", "c");
    expect(h.fetchToken).toHaveBeenCalledWith("s", "c");
    expect(h.connectRoom).toHaveBeenCalledWith("wss://x", "t", { e2ee: { kind: "channel", roomName: "s:c" } });
    expect(store.getState().voice.connectedRoom).toEqual({ spaceId: "s", channelId: "c", roomName: "s:c" });
  });

  it("blocks an unsupported WebView before fetching a token", async () => {
    h.e2eeSupported = false;
    await expect(joinVoiceChannel("s", "c")).rejects.toThrow(/supported on this device/);
    expect(h.fetchToken).not.toHaveBeenCalled();
    expect(h.connectRoom).not.toHaveBeenCalled();
    expect(store.getState().voice.mediaError).toMatch(/end-to-end encrypted/i);
    expect(store.getState().voice.connecting).toBe(false);
  });

  it("maps the backend's E2EE_REQUIRED refusal to an update message", async () => {
    h.fetchToken.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "E2EE_REQUIRED", status: 409 }));
    await expect(joinVoiceChannel("s", "c")).rejects.toThrow();
    expect(store.getState().voice.mediaError).toMatch(/Update The Wired/);
    expect(h.connectRoom).not.toHaveBeenCalled();
  });
});
