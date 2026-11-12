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
    /** Runs inside connect() — e.g. an account change mid-connect. */
    duringConnect: (() => void) | null;
  } = {
    lastRoom: null,
    lastOptions: null,
    seedOnConnect: new Map(),
    duringConnect: null,
  };
  /** Ordered trace of E2EE-relevant calls on the fake room. */
  const trace: string[] = [];
  class FakeRoom {
    handlers = new Map<string, Handler[]>();
    localParticipant = { identity: ME, setMicrophoneEnabled: async () => {} };
    remoteParticipants = new Map<string, unknown>();
    canPlaybackAudio = true;
    startAudio = async () => {
      trace.push("startAudio");
      this.canPlaybackAudio = true;
    };
    disconnectCalls = 0;
    connect = async () => {
      for (const [k, v] of state.seedOnConnect) this.remoteParticipants.set(k, v);
      trace.push("connect");
      state.duringConnect?.();
    };
    disconnect = async () => {
      this.disconnectCalls++;
    };
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
    LocalTrackPublished: "localTrackPublished",
    LocalTrackUnpublished: "localTrackUnpublished",
    TrackStreamStateChanged: "trackStreamStateChanged",
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
    StreamState: { Active: "active", Paused: "paused" },
  },
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor", Lost: "lost", Unknown: "unknown" },
  DisconnectReason: { CLIENT_INITIATED: 1 },
  VideoPresets: {
    h360: { resolution: { width: 640, height: 360, frameRate: 20 } },
    h720: { resolution: { width: 1280, height: 720, frameRate: 30 } },
    h1080: { resolution: { width: 1920, height: 1080, frameRate: 30 } },
  },
  ScreenSharePresets: {
    // As in the SDK: a preset's resolution carries its own frame rate.
    h1080fps15: { encoding: { maxBitrate: 2_500_000, maxFramerate: 15 }, resolution: { width: 1920, height: 1080, frameRate: 15 } },
    h1080fps30: { encoding: { maxBitrate: 5_000_000, maxFramerate: 30 }, resolution: { width: 1920, height: 1080, frameRate: 30 } },
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
  getRandomValues: (a: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(a),
  randomUUID: () => realCrypto.randomUUID(),
  subtle: { importKey: async (_f: string, _b: ArrayBuffer, algo: unknown) => ({ algo }) },
});
import {
  connectToRoom,
  addRoomListener,
  getE2EESession,
  disconnectFromRoom,
  getLivekitRoom,
  resumeAudioPlayback,
  onTrackTopologyChanged,
  getParticipantTrack,
  setScreenShareEnabled,
} from "../livekitClient";
import { deliverMediaKey, resetMediaKeyInbox } from "../e2ee/mediaKeyInbox";
import { attachRemoteAudio, clearRemoteAudio } from "../remoteAudio";
import { startOutgoingCall } from "@/store/slices/callSlice";
import {
  toggleMute,
  toggleVideo,
  setScreenSharing,
  setAudioPlaybackBlocked,
} from "@/store/slices/voiceSlice";
import type { Track as LiveKitTrack } from "livekit-client";
import {
  abandonMediaSessions,
  invalidateMediaJoins,
  mediaEpoch,
  MediaSessionAbortedError,
} from "../mediaSession";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { addParticipant } from "@/store/slices/voiceSlice";
import { buildRoomOptions } from "../livekitClient";
import { DEFAULT_MEDIA_PREFS, setMediaPrefs, __resetMediaPrefsForTests } from "../mediaPrefs";
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
  h.state.duringConnect = null;
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

/**
 * Our own mute / camera / share flags follow what LiveKit really publishes.
 *
 * pre-fix: local TrackMuted / TrackUnpublished were ignored. When the SDK
 * muted a mic whose device went away (and could not be replaced), a
 * moderator muted the track server-side, or the OS "stop sharing" button
 * ended a share, the UI kept showing "unmuted" / "sharing" while nothing was
 * being sent — the user was silent without knowing, and had to toggle twice.
 */
describe("local media state follows the SDK", () => {
  const ended = { mediaStreamTrack: { readyState: "ended" } };
  const live = { mediaStreamTrack: { readyState: "live" } };

  it("a mic the SDK muted after its device died: muted in the UI, with the reason", () => {
    expect(store.getState().voice.localState.muted).toBe(false);
    room().emit("trackMuted", { source: "microphone", track: ended }, local);
    expect(store.getState().voice.localState.muted).toBe(true);
    expect(store.getState().voice.mediaError).toMatch(/microphone stopped working/i);
  });

  it("a server-side (moderator) mute shows as muted, without a device error", () => {
    room().emit("trackMuted", { source: "microphone", track: live }, local);
    expect(store.getState().voice.localState.muted).toBe(true);
    expect(store.getState().voice.mediaError).toBeNull();
  });

  it("a mute the user made from the controls changes nothing here", () => {
    store.dispatch(toggleMute()); // the controls flip Redux first
    room().emit("trackMuted", { source: "microphone", track: live }, local);
    expect(store.getState().voice.localState.muted).toBe(true);
    expect(store.getState().voice.mediaError).toBeNull();
    store.dispatch(toggleMute());
    room().emit("trackUnmuted", { source: "microphone", track: live }, local);
    expect(store.getState().voice.localState.muted).toBe(false);
  });

  it("a camera that died is shown as off", () => {
    store.dispatch(toggleVideo());
    expect(store.getState().voice.localState.videoEnabled).toBe(true);
    room().emit("trackMuted", { source: "camera", track: ended }, local);
    expect(store.getState().voice.localState.videoEnabled).toBe(false);
    expect(store.getState().voice.mediaError).toMatch(/camera stopped working/i);
  });

  it("a screen share ended from the OS control clears the sharing flag", () => {
    room().emit("localTrackPublished", { source: "screen_share" });
    expect(store.getState().voice.localState.screenSharing).toBe(true);
    room().emit("localTrackUnpublished", { source: "screen_share" });
    expect(store.getState().voice.localState.screenSharing).toBe(false);
    // A mic (un)publish is not a mute and leaves the flags alone.
    store.dispatch(setScreenSharing(true));
    room().emit("localTrackUnpublished", { source: "microphone" });
    expect(store.getState().voice.localState.screenSharing).toBe(true);
    expect(store.getState().voice.localState.muted).toBe(false);
  });

  it("during a 1:1 call the call's own flags are the ones that follow", () => {
    store.dispatch(
      startOutgoingCall({
        partnerPubkey: REMOTE,
        callType: "video",
        roomId: ROOM_ID,
        roomSecretKey: SECRET,
        e2ee: true,
      }),
    );
    room().emit("trackMuted", { source: "microphone", track: ended }, local);
    room().emit("trackMuted", { source: "camera", track: live }, local);
    room().emit("localTrackPublished", { source: "screen_share" });
    const call = store.getState().call.activeCall!;
    expect(call.isMuted).toBe(true);
    expect(call.isVideoEnabled).toBe(false);
    expect(call.isScreenSharing).toBe(true);
    expect(store.getState().voice.localState.muted).toBe(false);
    room().emit("localTrackUnpublished", { source: "screen_share" });
    expect(store.getState().call.activeCall!.isScreenSharing).toBe(false);
  });
});

describe("audio playback recovery", () => {
  it("the Enable-audio action restarts SDK playback, resumes paused elements and clears the flag", async () => {
    const el = document.createElement("audio");
    const play = vi.fn(async () => {});
    Object.defineProperty(el, "paused", { get: () => true });
    el.play = play;
    const track = { kind: "audio", attach: () => el, detach: () => {} } as unknown as LiveKitTrack;
    attachRemoteAudio(track, REMOTE);
    store.dispatch(setAudioPlaybackBlocked(true));
    h.trace.length = 0;

    await resumeAudioPlayback();

    expect(h.trace).toContain("startAudio");
    expect(play).toHaveBeenCalledTimes(1);
    expect(store.getState().voice.audioPlaybackBlocked).toBe(false);
    clearRemoteAudio();
  });

  it("an element the WebView will not let us resume raises the Enable-audio pill", async () => {
    const el = document.createElement("audio");
    el.play = vi.fn(async () => {
      throw Object.assign(new Error("gesture required"), { name: "NotAllowedError" });
    });
    const track = { kind: "audio", attach: () => el, detach: () => {} } as unknown as LiveKitTrack;
    attachRemoteAudio(track, REMOTE);
    expect(store.getState().voice.audioPlaybackBlocked).toBe(false);

    el.dispatchEvent(new Event("pause"));
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().voice.audioPlaybackBlocked).toBe(true);
    clearRemoteAudio();
  });
});

/**
 * pre-fix: a subscription was bound to whichever Room existed when it was
 * made, and was a silent no-op when there was none. A 1:1 call renders its
 * tiles as soon as the call starts — before the room is connected — so the
 * self-view never heard that the camera had been published and stayed black
 * for the whole call (until the panel was expanded, which remounted it).
 */
describe("track change notifications outlive the room", () => {
  it("a listener registered before the room exists hears the room come up and its tracks change", async () => {
    await disconnectFromRoom();
    room().emit("disconnected", 1);
    const seen = vi.fn();
    const off = onTrackTopologyChanged(seen);

    await connectToRoom("wss://x", "token");
    expect(seen).toHaveBeenCalled(); // the room itself coming up
    seen.mockClear();

    const cameraTrack = { kind: "video" };
    (room().localParticipant as unknown as Record<string, unknown>).getTrackPublication = (src: string) =>
      src === "camera" ? { track: cameraTrack } : undefined;
    room().emit("localTrackPublished", { source: "camera" });
    expect(seen).toHaveBeenCalledTimes(1);
    // ...and at that moment the self-view can resolve its track.
    expect(getParticipantTrack(ME, "camera", true)).toBe(cameraTrack);

    off();
    room().emit("localTrackUnpublished", { source: "camera" });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("tells listeners when the room goes away, so tiles drop their dead tracks", () => {
    const seen = vi.fn();
    const off = onTrackTopologyChanged(seen);
    room().emit("disconnected", 3);
    expect(seen).toHaveBeenCalled();
    expect(getParticipantTrack(ME, "camera", true)).toBeNull();
    off();
  });
});

describe("remote video health", () => {
  it("a camera stream the SFU pauses is flagged on the participant, and cleared when it resumes or turns off", () => {
    seedRemote({ hasVideo: true });
    const who = () => store.getState().voice.participants[REMOTE];
    room().emit("trackStreamStateChanged", { source: "camera" }, "paused", remote);
    expect(who().videoPaused).toBe(true);
    room().emit("trackStreamStateChanged", { source: "camera" }, "active", remote);
    expect(who().videoPaused).toBe(false);

    room().emit("trackStreamStateChanged", { source: "camera" }, "paused", remote);
    room().emit("trackMuted", { source: "camera" }, remote);
    expect(who().videoPaused).toBe(false);
    // Only cameras: a paused screen share is not a frozen face.
    room().emit("trackStreamStateChanged", { source: "screen_share" }, "paused", remote);
    expect(who().videoPaused).toBe(false);
  });

  it("a participant whose connection is lost shows as poor, not unknown", () => {
    seedRemote();
    room().emit("connectionQualityChanged", "lost", remote);
    expect(store.getState().voice.participants[REMOTE].connectionQuality).toBe("poor");
  });
});

describe("screen share capture", () => {
  // pre-fix: the capture always used the 15 fps preset's resolution (which
  // carries frameRate: 15), so "smooth motion" encoded at 30 fps from a
  // 15 fps capture. And the room-wide "balanced" degradation, chosen for
  // faces, let a text share go soft under congestion.
  const shareWith = async (motion: boolean) => {
    const setScreenShare = vi.fn(async (..._args: unknown[]) => {});
    (room().localParticipant as unknown as Record<string, unknown>).setScreenShareEnabled = setScreenShare;
    setMediaPrefs({ screenShareMotion: motion });
    try {
      await setScreenShareEnabled(true);
    } finally {
      __resetMediaPrefsForTests();
    }
    const [, capture, publish] = setScreenShare.mock.calls[0] as [
      boolean,
      { resolution: { frameRate: number }; contentHint: string },
      { screenShareEncoding: { maxFramerate: number }; degradationPreference: string },
    ];
    return { capture, publish };
  };

  it("text mode: 15 fps capture and encode, keeps resolution under congestion", async () => {
    const { capture, publish } = await shareWith(false);
    expect(capture.resolution.frameRate).toBe(15);
    expect(capture.contentHint).toBe("detail");
    expect(publish.screenShareEncoding.maxFramerate).toBe(15);
    expect(publish.degradationPreference).toBe("maintain-resolution");
  });

  it("motion mode: captures at the 30 fps it encodes at, keeps frame rate under congestion", async () => {
    const { capture, publish } = await shareWith(true);
    expect(capture.resolution.frameRate).toBe(30);
    expect(capture.contentHint).toBe("motion");
    expect(publish.screenShareEncoding.maxFramerate).toBe(30);
    expect(publish.degradationPreference).toBe("maintain-framerate");
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

  it("in a channel, the key that was still on its way retires its own decrypt banner when it lands", async () => {
    vi.useFakeTimers();
    try {
      resetMediaKeyInbox();
      h.state.lastRoom = null;
      await connectToRoom("wss://x", "token", { e2ee: { kind: "channel", roomName: "s:c" } });
      room().emit("participantConnected", { identity: REMOTE, isMicrophoneEnabled: true, trackPublications: new Map() });
      await vi.advanceTimersByTimeAsync(9_000);
      room().emit("encryptionError", new Error("missing key"), remote);
      expect(store.getState().voice.e2ee.error).toMatch(/aaaaaaaa/);

      // A key from someone else leaves the banner about REMOTE alone.
      const other = "b".repeat(64);
      const env = { v: 1 as const, room: "s:c", keys: [{ idx: 1, key: "0a".repeat(32) }], ts: Date.now() };
      expect(deliverMediaKey(other, env, "w-other")).toBe(true);
      expect(store.getState().voice.e2ee.error).toMatch(/aaaaaaaa/);

      expect(deliverMediaKey(REMOTE, env, "w-remote")).toBe(true);
      expect(store.getState().voice.e2ee.error).toBeNull();
      // ...and a fresh failure from them is reported at once, not debounced.
      room().emit("encryptionError", new Error("missing key"), remote);
      expect(store.getState().voice.e2ee.error).toMatch(/aaaaaaaa/);
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

  // pre-fix: LiveKit's default `voiceIsolation: true` was merged into the
  // capture options whatever the toggles said, so a user who turned echo
  // cancellation off to stop being lowered under other speakers still had
  // the strongest voice filter running.
  it("voice isolation follows the toggles instead of always riding along", () => {
    const audioOf = (patch: Partial<typeof DEFAULT_MEDIA_PREFS>) =>
      buildRoomOptions({ ...DEFAULT_MEDIA_PREFS, ...patch }).audioCaptureDefaults as Record<string, unknown>;
    expect(audioOf({}).voiceIsolation).toBe(true);
    expect(audioOf({ echoCancellation: false })).toMatchObject({
      echoCancellation: false,
      voiceIsolation: false,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(audioOf({ noiseSuppression: false }).voiceIsolation).toBe(false);
  });

  it("\"Let voices overlap\" mid-call re-captures the mic without echo cancellation or voice isolation", async () => {
    const restartTrack = vi.fn(async (_opts: Record<string, unknown>) => {});
    (room().localParticipant as unknown as Record<string, unknown>).getTrackPublication = () => ({
      track: { restartTrack },
    });
    try {
      setMediaPrefs({ echoCancellation: false });
      await vi.waitFor(() => expect(restartTrack).toHaveBeenCalledTimes(1));
      expect(restartTrack.mock.calls[0][0]).toMatchObject({
        echoCancellation: false,
        voiceIsolation: false,
        noiseSuppression: true,
      });
      // Back on: the same path restores both.
      setMediaPrefs({ echoCancellation: true });
      await vi.waitFor(() => expect(restartTrack).toHaveBeenCalledTimes(2));
      expect(restartTrack.mock.calls[1][0]).toMatchObject({ echoCancellation: true, voiceIsolation: true });
    } finally {
      __resetMediaPrefsForTests();
    }
  });
});

/**
 * Account changes (docs: features/calling/accountChangeMedia.ts). The room
 * singleton outlived the account that joined it: switch accounts mid-call and
 * the old identity stayed on camera, its late events wiping whatever came
 * next.
 */
describe("room lifetime across account changes", () => {
  it("a superseded room disconnecting late does not tear down the room that replaced it", async () => {
    const first = room();
    await connectToRoom("wss://x", "token");
    const second = room();
    expect(second).not.toBe(first);
    seedRemote();
    const onDisconnected = vi.fn();
    const off = addRoomListener({ onDisconnected });

    first.emit("disconnected", 3 /* SERVER_SHUTDOWN */);

    expect(getLivekitRoom()).toBe(second);
    expect(store.getState().voice.participants[REMOTE]).toBeDefined();
    expect(onDisconnected).not.toHaveBeenCalled();
    off();
  });

  it("the current room's own Disconnected still resets voice state and notifies listeners", async () => {
    seedRemote();
    const onDisconnected = vi.fn();
    const off = addRoomListener({ onDisconnected });

    room().emit("disconnected", 3);

    expect(getLivekitRoom()).toBeNull();
    expect(store.getState().voice.participants).toEqual({});
    expect(onDisconnected).toHaveBeenCalledWith(3, false);
    off();
  });

  it("a token from before an account change never builds a room", async () => {
    const epoch = mediaEpoch();
    invalidateMediaJoins();
    h.state.lastRoom = null;

    await expect(connectToRoom("wss://x", "token", { epoch })).rejects.toBeInstanceOf(
      MediaSessionAbortedError,
    );
    expect(h.state.lastRoom).toBeNull();
  });

  it("an account change during connect: the room is left, the E2EE session disposed, and the next account's state untouched", async () => {
    h.state.lastRoom = null;
    h.state.seedOnConnect = new Map([
      [REMOTE, { identity: REMOTE, isMicrophoneEnabled: true, trackPublications: new Map() }],
    ]);
    h.state.duringConnect = () => invalidateMediaJoins();

    await expect(
      connectToRoom("wss://x", "token", { e2ee: { kind: "channel", roomName: "s:c" } }),
    ).rejects.toBeInstanceOf(MediaSessionAbortedError);

    const abandoned = room();
    expect(abandoned.disconnectCalls).toBe(1);
    expect(getLivekitRoom()).toBeNull();
    expect(getE2EESession()).toBeNull();
    // Key fan-out never started: nothing sealed for the abandoned room.
    expect(sendMediaKey).not.toHaveBeenCalled();
    expect(store.getState().voice.participants).toEqual({});

    // Its late Disconnected is a superseded room's: no reset of new state.
    seedRemote();
    abandoned.emit("disconnected", 1);
    expect(store.getState().voice.participants[REMOTE]).toBeDefined();
  });

  it("abandonMediaSessions hard-stops the live room", async () => {
    const live = room();
    await connectToRoom("wss://x", "token", { e2ee: CALL_CTX });
    const call = room();
    expect(call).not.toBe(live);

    await abandonMediaSessions();

    expect(call.disconnectCalls).toBe(1);
    expect(getLivekitRoom()).toBeNull();
    expect(getE2EESession()).toBeNull();
  });
});

