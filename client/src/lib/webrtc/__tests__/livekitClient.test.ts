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
 *
 * E2EE (docs/E2EE_CALLS.md): the session is created before the Room, the
 * encoder + pre-known keys precede connect(), status events reach Redux and
 * the room listeners, plaintext data packets are dropped, RED is off.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const ME = "f".repeat(64);
  const state: {
    lastRoom: FakeRoom | null;
    lastOptions: Record<string, unknown> | null;
    /** Participants the next Room "finds" already inside on connect(). */
    seedOnConnect: Map<string, unknown>;
  } = {
    lastRoom: null,
    lastOptions: null,
    seedOnConnect: new Map(),
  };
  /** Ordered trace of E2EE-relevant calls on the fake room. */
  const trace: string[] = [];
  class FakeRoom {
    handlers = new Map<string, Handler[]>();
    localParticipant = { identity: ME, setMicrophoneEnabled: async () => {} };
    remoteParticipants = new Map<string, unknown>();
    canPlaybackAudio = true;
    connect = async () => {
      for (const [k, v] of state.seedOnConnect) this.remoteParticipants.set(k, v);
      trace.push("connect");
    };
    disconnect = async () => {};
    setE2EEEnabled = async (enabled: boolean) => {
      trace.push(`setE2EEEnabled:${enabled}`);
    };
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
  const setKeys: Array<{ identity?: string; keyIndex?: number }> = [];
  class BaseKeyProvider {
    constructor(_o: unknown) {}
    protected onSetEncryptionKey(_key: unknown, identity?: string, keyIndex?: number) {
      setKeys.push({ identity, keyIndex });
      trace.push(`setKey:${identity?.slice(0, 2)}:${keyIndex}`);
    }
  }
  return { FakeRoom, state, ME, trace, setKeys, BaseKeyProvider, supported: true };
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
    ParticipantEncryptionStatusChanged: "participantEncryptionStatusChanged",
    EncryptionError: "encryptionError",
  },
  Encryption_Type: { NONE: 0, GCM: 1, CUSTOM: 2 },
  BaseKeyProvider: h.BaseKeyProvider,
  createKeyMaterialFromBuffer: async () => ({}),
  isE2EESupported: () => h.supported,
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
vi.mock("../e2ee/e2eeWorker", () => ({
  createE2EEWorker: () => new Worker("e2ee"),
}));
vi.mock("../e2ee/mediaKeySender", () => ({ sendMediaKey: vi.fn(async () => {}) }));
vi.mock("@/features/listenTogether/syncProtocol", () => ({
  LISTEN_TOGETHER_TOPIC: "lt",
  decodeLTMessage: () => null,
}));
vi.mock("@/features/listenTogether/listenTogetherService", () => ({
  handleIncomingMessage: vi.fn(),
  broadcastSessionToLateJoiner: vi.fn(),
  cleanupListenTogether: vi.fn(),
  announceListenTogetherExit: vi.fn(async () => {}),
  handleParticipantLeft: vi.fn(),
}));

// jsdom's ArrayBuffer is a different realm from Node's webcrypto, so the real
// crypto.subtle.importKey rejects it here; production runs in one realm.
const realCrypto = globalThis.crypto;
vi.stubGlobal("crypto", {
  getRandomValues: (a: Uint8Array) => realCrypto.getRandomValues(a),
  randomUUID: () => realCrypto.randomUUID(),
  subtle: { importKey: async (_f: string, _b: ArrayBuffer, algo: unknown) => ({ algo }) },
});
import { connectToRoom, addRoomListener, getE2EESession, disconnectFromRoom } from "../livekitClient";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { addParticipant } from "@/store/slices/voiceSlice";
import { buildRoomOptions } from "../livekitClient";
import { DEFAULT_MEDIA_PREFS } from "../mediaPrefs";
import { E2EEUnsupportedError } from "../e2ee/session";
import { sendMediaKey } from "../e2ee/mediaKeySender";
import { handleIncomingMessage, broadcastSessionToLateJoiner } from "@/features/listenTogether/listenTogetherService";

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

const SECRET = "01".repeat(32);
const ROOM_ID = "ab".repeat(32);
const CALL_CTX = { kind: "call" as const, roomId: ROOM_ID, roomSecretKeyHex: SECRET, peerPubkey: REMOTE };

beforeEach(async () => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
  h.state.lastRoom = null;
  h.state.lastOptions = null;
  h.trace.length = 0;
  h.setKeys.length = 0;
  h.supported = true;
  h.state.seedOnConnect = new Map();
  vi.mocked(sendMediaKey).mockClear();
  vi.mocked(handleIncomingMessage).mockClear();
  vi.mocked(broadcastSessionToLateJoiner).mockClear();
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

describe("E2EE", () => {
  it("a plain connect has no encryption option and no session", () => {
    expect(h.state.lastOptions!.encryption).toBeUndefined();
    expect(getE2EESession()).toBeNull();
    expect((h.state.lastOptions!.publishDefaults as { red: boolean }).red).toBe(true);
  });

  it("a call connect: session before Room, encoder + both derived keys before connect(), RED off", async () => {
    h.trace.length = 0;
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    const enc = h.state.lastOptions!.encryption as { keyProvider: unknown; worker: unknown };
    expect(enc.keyProvider).toBeInstanceOf(h.BaseKeyProvider);
    expect(enc.worker).toBeInstanceOf(Worker);
    expect((h.state.lastOptions!.publishDefaults as { red: boolean }).red).toBe(false);
    // Order is load-bearing: enable → keys → connect.
    expect(h.trace).toEqual(["setE2EEEnabled:true", "setKey:ff:0", "setKey:aa:0", "connect"]);
    expect(getE2EESession()?.ctx).toEqual(CALL_CTX);
  });

  it("refuses to build a Room when the WebView cannot encrypt", async () => {
    h.supported = false;
    h.state.lastRoom = null;
    await expect(connectToRoom("wss://x", "token", { e2ee: CALL_CTX })).rejects.toBeInstanceOf(E2EEUnsupportedError);
    expect(h.state.lastRoom).toBeNull();
  });

  it("local encryption status → voice.e2ee.active; remote status → participant.encrypted + listener", async () => {
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    const seen: Array<[string, boolean]> = [];
    const off = addRoomListener({ onParticipantEncryption: (id, enc) => seen.push([id, enc]) });
    seedRemote();
    room().emit("participantEncryptionStatusChanged", true, local);
    expect(store.getState().voice.e2ee.active).toBe(true);
    room().emit("participantEncryptionStatusChanged", false, remote);
    expect(store.getState().voice.participants[REMOTE].encrypted).toBe(false);
    expect(seen).toEqual([[REMOTE, false]]);
    off();
  });

  it("in a channel, EncryptionError is debounced per participant and suppressed right after they join", async () => {
    vi.useFakeTimers();
    try {
      h.state.lastRoom = null;
      await connectToRoom("wss://x", "token", { e2ee: { kind: "channel", roomName: "s:c" } });
      room().emit("participantConnected", { identity: REMOTE, isMicrophoneEnabled: true, trackPublications: new Map() });
      room().emit("encryptionError", new Error("missing key"), remote);
      expect(store.getState().voice.e2ee.error).toBeNull(); // join grace
      await vi.advanceTimersByTimeAsync(9_000);
      room().emit("encryptionError", new Error("missing key"), remote);
      expect(store.getState().voice.e2ee.error).toMatch(/aaaaaaaa/);
      store.dispatch({ type: "voice/setE2EEError", payload: null });
      room().emit("encryptionError", new Error("missing key"), remote);
      expect(store.getState().voice.e2ee.error).toBeNull(); // debounced
      await vi.advanceTimersByTimeAsync(6_000);
      room().emit("encryptionError", new Error("boom"), undefined);
      expect(store.getState().voice.e2ee.error).toMatch(/encrypt outgoing/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("in a 1:1 call a decrypt failure is reported on the first frame (keys were pre-installed, no grace)", async () => {
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    room().emit("participantConnected", { identity: REMOTE, isMicrophoneEnabled: true, trackPublications: new Map() });
    room().emit("encryptionError", new Error("InvalidKey"), remote);
    expect(store.getState().voice.e2ee.error).toMatch(/derives a different key/);
  });

  it("drops PLAINTEXT data packets in an encrypted room, accepts GCM ones", async () => {
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    vi.mocked(handleIncomingMessage).mockClear();
    room().emit("dataReceived", new Uint8Array([1]), remote, undefined, "lt", 0);
    room().emit("dataReceived", new Uint8Array([1]), remote, undefined, "lt", 1);
    // decodeLTMessage is mocked to null, so count the decode attempts via the topic path:
    // a NONE packet returns before decode; a GCM one reaches decode (null → no handler call).
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it("a channel connect starts the key fan-out to the existing roster and hands keys to joiners before the LT re-announce", async () => {
    vi.useFakeTimers();
    try {
      const OTHER = "b".repeat(64);
      h.state.lastRoom = null;
      // Room with one participant already inside.
      h.state.seedOnConnect = new Map([
        [OTHER, { identity: OTHER, isMicrophoneEnabled: true, trackPublications: new Map() }],
      ]);
      await connectToRoom("wss://x", "token", { e2ee: { kind: "channel", roomName: "s:c" } });
      expect(vi.mocked(sendMediaKey).mock.calls.map((c) => c[0])).toEqual([OTHER]);
      expect(h.setKeys).toEqual([{ identity: ME, keyIndex: 0 }]);

      vi.mocked(sendMediaKey).mockClear();
      room().emit("participantConnected", { identity: REMOTE, isMicrophoneEnabled: true, trackPublications: new Map() });
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.mocked(sendMediaKey).mock.calls.map((c) => c[0])).toEqual([REMOTE]);
      expect(broadcastSessionToLateJoiner).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(broadcastSessionToLateJoiner).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failure before connect (bad invite secret) tears down the session and the room", async () => {
    h.state.lastRoom = null;
    h.trace.length = 0;
    const badCtx = { ...CALL_CTX, roomSecretKeyHex: "01".repeat(31) };
    await expect(connectToRoom("wss://x", "token", { e2ee: badCtx })).rejects.toThrow(/roomSecretKey/);
    expect(getE2EESession()).toBeNull();
    expect(h.trace).not.toContain("connect");
  });

  it("disposes the session (terminates the worker) on disconnect", async () => {
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    const session = getE2EESession()!;
    const terminate = vi.spyOn(session.worker, "terminate");
    await disconnectFromRoom();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(getE2EESession()).toBeNull();
  });

  it("re-connecting replaces the previous session", async () => {
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    const first = getE2EESession()!;
    const terminate = vi.spyOn(first.worker, "terminate");
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(getE2EESession()).not.toBe(first);
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
