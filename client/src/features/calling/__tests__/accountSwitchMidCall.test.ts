/**
 * Switching accounts in the middle of a call.
 *
 * The bug: the LiveKit room is a module singleton (`livekitClient.ts`) that
 * no account-change path ever touched. `switchAccount()` / `performLogout()`
 * / the add-account flow ran `performCleanup()` and `resetAll()`, which wiped
 * the `voice` + `call` slices while the room stayed connected. The camera and
 * mic kept publishing as the OLD account with no UI left to hang up. The
 * room's E2EE key manager then sealed its key envelopes with the NEW
 * account's signer, linking the two accounts for every participant. Switching
 * back found an orphaned room the app no longer knew about.
 *
 * These run the real account-change code (`switchAccount`, `performCleanup`,
 * `performLogout`), the real LiveKit wiring (`livekitClient`), and the real
 * voice/call services. Only the SDK, the network, and the signer are faked.
 * The fake Room behaves like livekit-client on the parts that matter here:
 * the identity comes from the token, `disconnect()` stops local tracks and
 * emits `Disconnected(CLIENT_INITIATED)`, and a disconnected room emits
 * nothing more.
 *
 * Login after a switch can't reach relays in tests (bootstrap rejects), so a
 * test that needs the new account "logged in" dispatches `login()` itself,
 * the way `performLogin` would on success.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const state = {
    rooms: [] as FakeRoom[],
    /** Remote identities the next Room finds already inside on connect(). */
    seed: [] as string[],
    /** When set, token fetches wait for it (to switch accounts mid-join). */
    tokenGate: null as Promise<void> | null,
    /** Identity active in the store; read by the fakes that sign or mint. */
    identity: () => null as string | null,
    /** Everything the fake signer sealed, and as whom. */
    signed: [] as Array<{ as: string | null; kind: string; to?: string }>,
    presence: [] as Array<{ op: "publish" | "clear"; as: string | null; roomRef?: string }>,
  };

  class FakeLocal {
    identity = "";
    mic = false;
    cam = false;
    screen = false;
    constructor(private readonly room: FakeRoom) {}
    async setMicrophoneEnabled(on: boolean) {
      if (this.room.state !== "connected") return;
      this.mic = on;
    }
    async setCameraEnabled(on: boolean) {
      if (this.room.state !== "connected") return;
      this.cam = on;
    }
    async setScreenShareEnabled(on: boolean) {
      if (this.room.state !== "connected") return;
      this.screen = on;
    }
    getTrackPublication() {
      return undefined;
    }
  }

  function remote(identity: string) {
    return {
      identity,
      name: identity,
      isMicrophoneEnabled: true,
      isCameraEnabled: true,
      isScreenShareEnabled: false,
      connectionQuality: "unknown",
      trackPublications: new Map(),
      isEncrypted: true,
    };
  }

  class FakeRoom {
    state: "new" | "connected" | "disconnected" = "new";
    handlers = new Map<string, Handler[]>();
    localParticipant = new FakeLocal(this);
    remoteParticipants = new Map<string, ReturnType<typeof remote>>();
    canPlaybackAudio = true;
    constructor(_opts: unknown) {
      state.rooms.push(this);
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
    private emit(ev: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(ev) ?? []) fn(...args);
    }
    async setE2EEEnabled() {}
    async switchActiveDevice() {
      return true;
    }
    async connect(_url: string, token: string) {
      // LiveKit identity = whatever the token was minted for.
      this.localParticipant.identity = token.replace(/^tok:/, "");
      for (const id of state.seed) this.remoteParticipants.set(id, remote(id));
      this.state = "connected";
    }
    async disconnect() {
      if (this.state === "disconnected") return;
      this.state = "disconnected";
      this.localParticipant.mic = false;
      this.localParticipant.cam = false;
      this.localParticipant.screen = false;
      this.emit("disconnected", 1 /* CLIENT_INITIATED */);
    }
    /** A remote participant joins (only a live room hears about it). */
    remoteJoins(identity: string) {
      if (this.state !== "connected") return;
      const p = remote(identity);
      this.remoteParticipants.set(identity, p);
      this.emit("participantConnected", p);
    }
  }

  return { state, FakeRoom };
});

const A = "a".repeat(64);
const B = "b".repeat(64);
const PEER = "c".repeat(64);
const LATE_JOINER = "d".repeat(64);
const SPACE = "space1";
const CHANNEL = "video1";

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
    LocalTrackPublished: "localTrackPublished",
    LocalTrackUnpublished: "localTrackUnpublished",
  },
  Encryption_Type: { NONE: 0, GCM: 1, CUSTOM: 2 },
  BaseKeyProvider: class {
    constructor(_o: unknown) {}
    protected onSetEncryptionKey() {}
  },
  createKeyMaterialFromBuffer: async () => ({}),
  isE2EESupported: () => true,
  Track: {
    Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen_share" },
    Kind: { Audio: "audio", Video: "video" },
  },
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor", Unknown: "unknown" },
  DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, SERVER_SHUTDOWN: 3 },
  VideoPresets: {
    h360: { resolution: { width: 640, height: 360 } },
    h720: { resolution: { width: 1280, height: 720 } },
    h1080: { resolution: { width: 1920, height: 1080 } },
  },
  ScreenSharePresets: {
    h1080fps15: { encoding: {}, resolution: { width: 1920, height: 1080 } },
    h1080fps30: { encoding: {}, resolution: { width: 1920, height: 1080 } },
  },
}));
vi.mock("@/lib/webrtc/e2ee/e2eeWorker", () => ({ createE2EEWorker: () => new Worker("e2ee") }));
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

// The backend mints the LiveKit identity from the NIP-98 caller = whoever
// is logged in when the token is requested.
async function mintToken(roomName: string) {
  const as = h.state.identity();
  if (h.state.tokenGate) await h.state.tokenGate;
  return { token: `tok:${as}`, url: "wss://livekit.test", roomName };
}
vi.mock("@/lib/api/voice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/voice")>()),
  fetchVoiceToken: (s: string, c: string) => mintToken(`${s}:${c}`),
  fetchDMVoiceToken: (_p: string, roomId: string) => mintToken(`dm:${roomId}`),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  api: vi.fn(async () => ({ data: {} })),
}));
vi.mock("@/lib/nostr/roomPresence", () => ({
  publishRoomPresence: vi.fn(async (roomRef: string) => {
    h.state.presence.push({ op: "publish", as: h.state.identity(), roomRef });
  }),
  clearRoomPresence: vi.fn(async () => {
    h.state.presence.push({ op: "clear", as: h.state.identity() });
  }),
}));
// Signing happens with whatever signer is active, i.e. the current account.
vi.mock("@/lib/nostr/giftWrap", async (importOriginal) => {
  const typeOf = (tags?: string[][]) => tags?.find((t) => t[0] === "type")?.[1] ?? "?";
  return {
    ...(await importOriginal<typeof import("@/lib/nostr/giftWrap")>()),
    buildRumor: vi.fn(async (from: string, to: string, content: string, tags: string[][], opts?: { kind?: number }) => ({
      pubkey: from,
      kind: opts?.kind ?? 14,
      tags: [["p", to], ...tags],
      content,
      created_at: 0,
      id: "rumor",
    })),
    createGiftWrappedDM: vi.fn(async (_c: string, to: string, tags?: string[][], rumor?: { kind?: number }) => {
      h.state.signed.push({ as: h.state.identity(), kind: rumor ? `kind:${rumor.kind}` : typeOf(tags), to });
      return { wrap: { id: `w${h.state.signed.length}` } };
    }),
    createSelfWrap: vi.fn(async (_c: string, _to: string, tags?: string[][]) => {
      h.state.signed.push({ as: h.state.identity(), kind: `self:${typeOf(tags)}` });
      return { wrap: { id: `s${h.state.signed.length}` } };
    }),
  };
});
vi.mock("@/lib/nostr/dmRelayList", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nostr/dmRelayList")>()),
  getDMRelaysForPublish: vi.fn(async () => []),
  getOwnDMRelays: vi.fn(() => []),
  fallbackDMRelays: vi.fn(() => ["wss://relay.test"]),
}));
// No sockets in tests: everything is a no-op, and login stops at bootstrap.
vi.mock("@/lib/nostr/relayManager", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/nostr/relayManager")>();
  const fns = new Map<PropertyKey, unknown>();
  const relayManager = new Proxy({} as typeof real.relayManager, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      if (prop === "connectToBootstrapAndWait") {
        return async () => {
          throw new Error("offline (test)");
        };
      }
      if (prop === "getAllConnections") return () => new Map();
      if (!fns.has(prop)) fns.set(prop, vi.fn());
      return fns.get(prop);
    },
  });
  return { ...real, relayManager };
});

// jsdom's ArrayBuffer is a different realm from Node's webcrypto (see
// livekitClient.test.ts); the key provider only needs importKey to resolve.
const realCrypto = globalThis.crypto;
vi.stubGlobal("crypto", {
  getRandomValues: (a: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(a),
  randomUUID: () => realCrypto.randomUUID(),
  subtle: { importKey: async (_f: string, _b: ArrayBuffer, algo: unknown) => ({ algo }) },
});

import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { toggleVideo } from "@/store/slices/voiceSlice";
import {
  switchAccount,
  performCleanup,
  performLogout,
  addAccountFromSecret,
} from "@/lib/nostr/loginFlow";
import { invoke } from "@tauri-apps/api/core";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils";
import { saveUserState, setActivePubkey } from "@/lib/db/userStateStore";
import { getLivekitRoom, disconnectFromRoom } from "@/lib/webrtc/livekitClient";
import { joinVoiceChannel, toggleCamera } from "@/features/voice/voiceService";
import { initiateCall, hangupCall } from "../callService";
import { resetMediaKeyInbox } from "@/lib/webrtc/e2ee/mediaKeyInbox";

h.state.identity = () => store.getState().identity.pubkey;

const liveRooms = () => h.state.rooms.filter((r) => r.state === "connected");
const lastRoom = () => h.state.rooms[h.state.rooms.length - 1];

async function loginAs(pubkey: string) {
  setActivePubkey(pubkey);
  store.dispatch(login({ pubkey, signerType: "nip07" }));
}

/** The real switchAccount; login then fails at bootstrap (no relays in
 *  tests), so finish it the way a successful performLogin would. */
async function switchTo(pubkey: string) {
  await switchAccount(pubkey).catch((err: Error) => {
    if (!/offline \(test\)/.test(err.message)) throw err;
  });
  await loginAs(pubkey);
}

async function joinVideoChannelWithCamera() {
  await joinVoiceChannel(SPACE, CHANNEL);
  store.dispatch(toggleVideo());
  await toggleCamera();
}

beforeEach(async () => {
  store.dispatch(resetAll());
  h.state.rooms.length = 0;
  h.state.seed = [PEER];
  h.state.tokenGate = null;
  h.state.signed.length = 0;
  h.state.presence.length = 0;
  resetMediaKeyInbox();
  setActivePubkey(A);
  await saveUserState("session", {
    accounts: [
      { pubkey: A, signerType: "nip07", addedAt: 1 },
      { pubkey: B, signerType: "nip07", addedAt: 2 },
    ],
    activePubkey: A,
  });
  await loginAs(A);
});

afterEach(async () => {
  await hangupCall({ notifyPeer: false }).catch(() => {});
  await disconnectFromRoom().catch(() => {});
  h.state.tokenGate = null;
});

describe("switching accounts while in a space video channel", () => {
  it("ends the call: the room disconnects and the camera stops", async () => {
    await joinVideoChannelWithCamera();
    const room = lastRoom();
    expect(room.state).toBe("connected");
    expect(room.localParticipant.identity).toBe(A);
    expect(room.localParticipant.cam).toBe(true);

    await switchTo(B);

    expect(room.state).toBe("disconnected");
    expect(room.localParticipant.cam).toBe(false);
    expect(room.localParticipant.mic).toBe(false);
    expect(getLivekitRoom()).toBeNull();
    expect(liveRooms()).toHaveLength(0);
  });

  it("clears the old account's room presence, signed as the old account", async () => {
    await joinVideoChannelWithCamera();
    expect(h.state.presence).toEqual([
      { op: "publish", as: A, roomRef: `30312:${SPACE}:${CHANNEL}` },
    ]);

    await switchTo(B);

    expect(h.state.presence).toContainEqual({ op: "clear", as: A });
    expect(h.state.presence.filter((p) => p.as === B)).toEqual([]);
  });

  it("never signs anything for the old room as the new account (no cross-account linkage)", async () => {
    await joinVideoChannelWithCamera();
    const room = lastRoom();

    await switchTo(B);
    // Someone joins the channel the old account was in. A live E2EE session
    // would gift-wrap its sender key to them — sealed by the current signer.
    room.remoteJoins(LATE_JOINER);
    await new Promise((r) => setTimeout(r, 0));

    expect(h.state.signed.filter((s) => s.as === B)).toEqual([]);
  });

  it("leaves no stale voice state behind for the new account", async () => {
    await joinVideoChannelWithCamera();
    const room = lastRoom();

    await switchTo(B);
    room.remoteJoins(LATE_JOINER);

    const voice = store.getState().voice;
    expect(voice.connectedRoom).toBeNull();
    expect(voice.participants).toEqual({});
  });

  it("switching back starts clean, and rejoining gives exactly one live room as the right identity", async () => {
    await joinVideoChannelWithCamera();
    await switchTo(B);
    await switchTo(A);

    // Nothing from the first session is still running under A.
    expect(liveRooms()).toHaveLength(0);
    expect(getLivekitRoom()).toBeNull();
    expect(store.getState().voice.connectedRoom).toBeNull();

    await joinVoiceChannel(SPACE, CHANNEL);
    const room = lastRoom();
    expect(liveRooms()).toEqual([room]);
    expect(room.localParticipant.identity).toBe(A);
    expect(store.getState().voice.connectedRoom).toEqual({
      spaceId: SPACE,
      channelId: CHANNEL,
      roomName: `${SPACE}:${CHANNEL}`,
    });
  });

  it("a join still in flight when the account changes does not land in the new account", async () => {
    let release!: () => void;
    h.state.tokenGate = new Promise<void>((r) => (release = r));
    const join = joinVoiceChannel(SPACE, CHANNEL); // token requested as A

    await switchTo(B);
    release();
    await join.catch(() => {});

    expect(store.getState().voice.connectedRoom).toBeNull();
    expect(liveRooms()).toHaveLength(0);
    expect(h.state.presence.filter((p) => p.op === "publish")).toEqual([]);
  });
});

describe("other account-change paths", () => {
  it("add account (performCleanup + resetAll) disconnects the call", async () => {
    await joinVideoChannelWithCamera();
    const room = lastRoom();

    // AddAccountModal / Security › Import Key: clean up, reset, log in.
    performCleanup();
    store.dispatch(resetAll());
    await new Promise((r) => setTimeout(r, 0));

    expect(room.state).toBe("disconnected");
    expect(liveRooms()).toHaveLength(0);
  });

  it("log out disconnects the call", async () => {
    await joinVideoChannelWithCamera();
    const room = lastRoom();

    await performLogout();

    expect(room.state).toBe("disconnected");
    expect(liveRooms()).toHaveLength(0);
  });
});

describe("switching accounts during a 1:1 DM video call", () => {
  it("hangs up and stops the camera", async () => {
    await initiateCall(PEER, "video");
    const room = lastRoom();
    expect(store.getState().call.activeCall?.state).toBe("active");
    expect(room.localParticipant.cam).toBe(true);

    await switchTo(B);

    expect(room.state).toBe("disconnected");
    expect(room.localParticipant.cam).toBe(false);
    expect(store.getState().call.activeCall).toBeNull();
  });

  it("an outgoing call still ringing is cancelled as the old account, so the callee stops ringing", async () => {
    h.state.seed = []; // callee hasn't picked up
    await initiateCall(PEER, "video");
    expect(store.getState().call.activeCall?.state).toBe("ringing");

    await switchTo(B);

    expect(h.state.signed).toContainEqual({ as: A, kind: "call_missed", to: PEER });
    expect(h.state.signed.filter((s) => s.as === B)).toEqual([]);
    expect(liveRooms()).toHaveLength(0);
  });
});

describe("importing a key mid-meeting (QA: re-imported the same account)", () => {
  // QA report: on the main account inside a meeting, "Import account" with
  // the SAME account's hex key re-logged in and kept the meeting running,
  // but clicking the channel said "join" again (the reset forgot the live
  // room). Re-importing the active account must change nothing.
  const sk = generateSecretKey();
  const ME = getPublicKey(sk);
  const OTHER_SK = generateSecretKey();
  const OTHER = getPublicKey(OTHER_SK);

  beforeEach(async () => {
    store.dispatch(resetAll());
    await loginAs(ME);
    vi.mocked(invoke).mockClear();
  });

  afterEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockRejectedValue(new Error("Not in Tauri environment"));
  });

  it("re-importing the active account is a no-op: same session, call untouched", async () => {
    await joinVideoChannelWithCamera();
    const room = lastRoom();
    const before = store.getState().voice.connectedRoom;

    const result = await addAccountFromSecret(bytesToHex(sk));

    expect(result).toEqual({ status: "already_active" });
    expect(room.state).toBe("connected");
    expect(room.localParticipant.cam).toBe(true);
    expect(store.getState().voice.connectedRoom).toEqual(before);
    expect(store.getState().identity.pubkey).toBe(ME);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("keystore_import_key", expect.anything());
  });

  it("also recognises the active account from its nsec", async () => {
    const { nsecEncode } = await import("nostr-tools/nip19");
    await joinVideoChannelWithCamera();
    expect(await addAccountFromSecret(nsecEncode(sk))).toEqual({ status: "already_active" });
    expect(lastRoom().state).toBe("connected");
  });

  it("a different key ends the call as the current account BEFORE the keystore swaps signers", async () => {
    await joinVideoChannelWithCamera();
    const room = lastRoom();
    const atImport: { room?: string; presence?: typeof h.state.presence } = {};
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "keystore_import_key") {
        atImport.room = room.state;
        atImport.presence = [...h.state.presence];
        return OTHER;
      }
      throw new Error("Not in Tauri environment");
    });

    // Login then fails at bootstrap (no relays in tests).
    await addAccountFromSecret(bytesToHex(OTHER_SK)).catch((err: Error) => {
      if (!/offline \(test\)/.test(err.message)) throw err;
    });

    expect(atImport.room).toBe("disconnected");
    expect(atImport.presence).toContainEqual({ op: "clear", as: ME });
    expect(liveRooms()).toHaveLength(0);
  });

  it("an invalid key is rejected without touching the call", async () => {
    await joinVideoChannelWithCamera();
    await expect(addAccountFromSecret("not-a-key")).rejects.toThrow(/Invalid secret key/);
    expect(lastRoom().state).toBe("connected");
    expect(store.getState().voice.connectedRoom).not.toBeNull();
  });
});

