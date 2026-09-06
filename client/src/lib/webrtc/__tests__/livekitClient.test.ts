/**
 * LiveKit → Redux event wiring.
 *
 * pre-fix behaviors these pin down:
 *  - a remote camera-off is a TrackMuted(Camera) event (LiveKit mutes, it
 *    does not unpublish); only Microphone mutes were handled, so the tile
 *    kept hasVideo=true and showed a black/frozen frame.
 *  - Reconnecting/Reconnected were ignored — the UI froze silently.
 *  - local ConnectionQuality was detected via `instanceof
 *    room.localParticipant.constructor` (fragile); identity is the contract.
 *  - publish defaults were LiveKit's music preset with DTX on.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const ME = "f".repeat(64);
  const state: { lastRoom: FakeRoom | null; lastOptions: Record<string, unknown> | null } = {
    lastRoom: null,
    lastOptions: null,
  };
  class FakeRoom {
    handlers = new Map<string, Handler[]>();
    localParticipant = { identity: ME, setMicrophoneEnabled: async () => {} };
    remoteParticipants = new Map<string, unknown>();
    canPlaybackAudio = true;
    connect = async () => {};
    disconnect = async () => {};
    switchActiveDevice = async (_kind: string, _id: string) => true;
    constructor(opts: Record<string, unknown>) {
      state.lastOptions = opts;
      state.lastRoom = this;
    }
    on(ev: string, fn: Handler) {
      const list = this.handlers.get(ev) ?? [];
      list.push(fn);
      this.handlers.set(ev, list);
      return this;
    }
    off() {
      return this;
    }
    emit(ev: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(ev) ?? []) fn(...args);
    }
  }
  return { FakeRoom, state, ME };
});

const ME = h.ME;
const REMOTE = "a".repeat(64);
const room = () => h.state.lastRoom!;

vi.mock("livekit-client", () => ({
  Room: h.FakeRoom,
  RoomEvent: {
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    ConnectionQualityChanged: "connectionQualityChanged",
    TrackMuted: "trackMuted",
    TrackUnmuted: "trackUnmuted",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    AudioPlaybackStatusChanged: "audioPlaybackChanged",
    Disconnected: "disconnected",
    MediaDevicesError: "mediaDevicesError",
    DataReceived: "dataReceived",
    Reconnecting: "reconnecting",
    SignalReconnecting: "signalReconnecting",
    Reconnected: "reconnected",
  },
  Track: {
    Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" },
    Kind: { Audio: "audio", Video: "video" },
  },
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor", Unknown: "unknown" },
  DisconnectReason: { CLIENT_INITIATED: 1 },
  VideoPresets: {
    h360: { resolution: { width: 640, height: 360, frameRate: 20 } },
    h720: { resolution: { width: 1280, height: 720, frameRate: 30 } },
    h1080: { resolution: { width: 1920, height: 1080, frameRate: 30 } },
  },
  ScreenSharePresets: {
    h1080fps15: { encoding: { maxBitrate: 2_500_000, maxFramerate: 15 }, resolution: { width: 1920, height: 1080 } },
    h1080fps30: { encoding: { maxBitrate: 5_000_000, maxFramerate: 30 }, resolution: { width: 1920, height: 1080 } },
  },
}));
vi.mock("@/features/listenTogether/syncProtocol", () => ({
  LISTEN_TOGETHER_TOPIC: "lt",
  decodeLTMessage: () => null,
}));
vi.mock("@/features/listenTogether/listenTogetherService", () => ({
  handleIncomingMessage: vi.fn(),
  broadcastSessionToLateJoiner: vi.fn(),
  cleanupListenTogether: vi.fn(),
}));

import { connectToRoom } from "../livekitClient";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { addParticipant } from "@/store/slices/voiceSlice";
import { buildRoomOptions } from "../livekitClient";
import { DEFAULT_MEDIA_PREFS } from "../mediaPrefs";

function seedRemote(overrides: Partial<{ hasVideo: boolean; isMuted: boolean }> = {}) {
  store.dispatch(
    addParticipant({
      pubkey: REMOTE,
      displayName: "remote",
      isSpeaking: false,
      isMuted: false,
      isDeafened: false,
      hasVideo: true,
      isScreenSharing: false,
      connectionQuality: "unknown",
      handRaised: false,
      audioLevel: 0,
      ...overrides,
    }),
  );
}

const remote = { identity: REMOTE };
const local = { identity: ME };

beforeEach(async () => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
  h.state.lastRoom = null;
  h.state.lastOptions = null;
  await connectToRoom("wss://x", "token");
});

describe("remote camera on/off", () => {
  it("TrackMuted(Camera) clears hasVideo; TrackUnmuted restores it", () => {
    seedRemote({ hasVideo: true });
    room().emit("trackMuted", { source: "camera" }, remote);
    expect(store.getState().voice.participants[REMOTE].hasVideo).toBe(false);

    room().emit("trackUnmuted", { source: "camera" }, remote);
    expect(store.getState().voice.participants[REMOTE].hasVideo).toBe(true);
  });

  it("a camera that subscribes already muted does not show as video", () => {
    seedRemote({ hasVideo: true });
    room().emit(
      "trackSubscribed",
      { kind: "video" },
      { source: "camera", isMuted: true },
      remote,
    );
    expect(store.getState().voice.participants[REMOTE].hasVideo).toBe(false);
  });

  it("microphone mute still maps to isMuted", () => {
    seedRemote({ isMuted: false });
    room().emit("trackMuted", { source: "microphone" }, remote);
    expect(store.getState().voice.participants[REMOTE].isMuted).toBe(true);
  });

  it("local track mutes never touch the participant table", () => {
    seedRemote({ hasVideo: true });
    room().emit("trackMuted", { source: "camera" }, local);
    expect(store.getState().voice.participants[REMOTE].hasVideo).toBe(true);
  });
});

describe("transport state", () => {
  it("Reconnecting → reconnecting, Reconnected → connected", () => {
    expect(store.getState().voice.connectionState).toBe("connected");
    room().emit("reconnecting");
    expect(store.getState().voice.connectionState).toBe("reconnecting");
    room().emit("reconnected");
    expect(store.getState().voice.connectionState).toBe("connected");
  });

  it("SignalReconnecting also surfaces as reconnecting", () => {
    room().emit("signalReconnecting");
    expect(store.getState().voice.connectionState).toBe("reconnecting");
  });
});

describe("connection quality routing", () => {
  it("routes by identity: local → connectionQuality, remote → participant", () => {
    seedRemote();
    room().emit("connectionQualityChanged", "poor", local);
    expect(store.getState().voice.connectionQuality).toBe("poor");
    expect(store.getState().voice.participants[REMOTE].connectionQuality).toBe("unknown");

    room().emit("connectionQualityChanged", "excellent", remote);
    expect(store.getState().voice.participants[REMOTE].connectionQuality).toBe("excellent");
    expect(store.getState().voice.connectionQuality).toBe("poor");
  });
});

describe("media errors", () => {
  it("MediaDevicesError is surfaced as a readable mediaError", () => {
    const err = Object.assign(new Error("Could not start video source"), {
      name: "NotReadableError",
    });
    room().emit("mediaDevicesError", err);
    expect(store.getState().voice.mediaError).toMatch(/in use by another app/i);
  });
});

describe("room options", () => {
  it("publishes speech-tuned audio and hardware-friendly video: DTX off, RED on, H.264, 1080p top layer", () => {
    const pd = h.state.lastOptions!.publishDefaults as Record<string, unknown>;
    expect(pd.dtx).toBe(false);
    expect(pd.red).toBe(true);
    expect(pd.simulcast).toBe(true);
    expect(pd.videoCodec).toBe("h264");
    expect(pd.degradationPreference).toBe("balanced");
    const vc = h.state.lastOptions!.videoCaptureDefaults as { resolution: { height: number } };
    expect(vc.resolution.height).toBe(1080);
  });

  it("subscribes by device pixels so Retina tiles get the sharp layer", () => {
    expect(h.state.lastOptions!.adaptiveStream).toEqual({ pixelDensity: "screen" });
  });

  it("screen share encoding follows the motion preference", () => {
    const enc = (o: ReturnType<typeof buildRoomOptions>) =>
      (o.publishDefaults as { screenShareEncoding: { maxFramerate: number } }).screenShareEncoding.maxFramerate;
    expect(enc(buildRoomOptions({ ...DEFAULT_MEDIA_PREFS, screenShareMotion: false }))).toBe(15);
    expect(enc(buildRoomOptions({ ...DEFAULT_MEDIA_PREFS, screenShareMotion: true }))).toBe(30);
  });
});

describe("media prefs → room options", () => {
  it("feeds the chosen devices and processing flags into capture defaults", () => {
    const opts = buildRoomOptions({
      ...DEFAULT_MEDIA_PREFS,
      audioInput: "mic-9",
      videoInput: "cam-2",
      noiseSuppression: false,
    });
    const audio = opts.audioCaptureDefaults as Record<string, unknown>;
    const video = opts.videoCaptureDefaults as Record<string, unknown>;
    expect(audio.deviceId).toBe("mic-9");
    expect(audio.noiseSuppression).toBe(false);
    expect(audio.echoCancellation).toBe(true);
    expect(video.deviceId).toBe("cam-2");
  });

  it("omits deviceId for system default", () => {
    const opts = buildRoomOptions(DEFAULT_MEDIA_PREFS);
    expect((opts.audioCaptureDefaults as Record<string, unknown>).deviceId).toBeUndefined();
  });
});
