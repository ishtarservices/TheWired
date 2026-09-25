import { describe, it, expect, vi, beforeEach } from "vitest";

const publishData = vi.fn(async (_payload: Uint8Array, _opts: unknown) => {});
vi.mock("@/lib/webrtc/livekitClient", () => ({
  getLivekitRoom: () => ({ localParticipant: { publishData } }),
}));
const seekTrackTo = vi.fn();
vi.mock("@/features/music/useAudioPlayer", () => ({
  seekTrackTo: (...args: unknown[]) => seekTrackTo(...args),
}));

import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { startSession, setPendingInvite } from "@/store/slices/listenTogetherSlice";
import { setCurrentTrack, addTrack, nextTrack, setDuration, togglePlay, updatePosition } from "@/store/slices/musicSlice";
import {
  handleIncomingMessage,
  handleParticipantLeft,
  announceListenTogetherExit,
  joinListenTogetherSession,
  leaveListenTogetherSession,
  dismissInvite,
  suggestTrack,
  acceptSuggestion,
  startListenTogetherSession,
} from "../listenTogetherService";
import { anchorTime, decodeLTMessage, MAX_LATENCY_MS, type LTMessage, type LTMessageType, type TrackMeta } from "../syncProtocol";
import type { MusicTrack } from "@/types/music";

const ME = "a".repeat(64);
const DJ = "b".repeat(64);
const OTHER = "c".repeat(64);
const T1 = `31683:${DJ}:one`;
const T2 = `31683:${DJ}:two`;

const meta = (extra: Partial<TrackMeta> = {}): TrackMeta => ({
  title: "t",
  artist: "a",
  variants: [{ url: "https://blossom.example/x.mp3", mimeType: "audio/mpeg" }],
  ...extra,
});

function msg(type: LTMessageType, data: Record<string, unknown> = {}, ts = Date.now()): LTMessage {
  return { type, ts, dj: DJ, data };
}

function track(id: string, visibility: MusicTrack["visibility"] = "public"): MusicTrack {
  return {
    addressableId: id,
    eventId: "e",
    pubkey: DJ,
    title: id,
    artist: "a",
    artistPubkeys: [],
    featuredArtists: [],
    collaborators: [],
    hashtags: [],
    variants: meta().variants,
    createdAt: 0,
    visibility,
    spaceIds: [],
    inCatalog: true,
  };
}

/** Joined as a listener of DJ, playing T1. */
function joinAsListener(context: "space" | "dm" = "space") {
  store.dispatch(startSession({ context, roomId: "r", djPubkey: DJ, isLocalDJ: false }));
  store.dispatch(addTrack(track(T1)));
  store.dispatch(setCurrentTrack({ trackId: T1, queue: [T1], queueIndex: 0 }));
}

function sentTypes(): string[] {
  return publishData.mock.calls.map(
    ([payload]) => JSON.parse(new TextDecoder().decode(payload)).type as string,
  );
}

beforeEach(() => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
  publishData.mockClear();
  seekTrackTo.mockClear();
});

describe("DJ authority", () => {
  it("ignores playback controls from a participant who isn't the DJ", () => {
    joinAsListener();
    handleIncomingMessage(msg("lt:play", { trackId: T2, position: 0, queue: [T2], queueIndex: 0, trackMeta: meta() }), OTHER);
    handleIncomingMessage(msg("lt:pause", { position: 12 }), OTHER);
    handleIncomingMessage(msg("lt:end"), OTHER);

    const s = store.getState();
    expect(s.music.player.currentTrackId).toBe(T1);
    expect(s.music.player.isPlaying).toBe(true);
    expect(s.listenTogether.active).toBe(true);
  });

  it("applies the same controls from the DJ", () => {
    joinAsListener();
    handleIncomingMessage(msg("lt:pause", { position: 12 }), DJ);
    expect(store.getState().music.player.isPlaying).toBe(false);
    handleIncomingMessage(msg("lt:end"), DJ);
    expect(store.getState().listenTogether.active).toBe(false);
  });

  it("trusts the sender identity, not the envelope's dj field", () => {
    joinAsListener();
    handleIncomingMessage({ ...msg("lt:end"), dj: DJ }, OTHER);
    expect(store.getState().listenTogether.active).toBe(true);
  });

  it("follows a DJ transfer: the new DJ is obeyed, the old one isn't", () => {
    joinAsListener();
    handleIncomingMessage(msg("lt:transfer_dj", { targetPubkey: OTHER }), DJ);
    expect(store.getState().listenTogether.djPubkey).toBe(OTHER);

    handleIncomingMessage(msg("lt:pause", { position: 3 }), DJ);
    expect(store.getState().music.player.isPlaying).toBe(true);
    handleIncomingMessage(msg("lt:pause", { position: 3 }), OTHER);
    expect(store.getState().music.player.isPlaying).toBe(false);
  });

  it("a pending invite follows the inviter's DJ transfer", () => {
    handleIncomingMessage(start(), DJ);
    handleIncomingMessage(msg("lt:transfer_dj", { targetPubkey: OTHER }), DJ);
    const lt = store.getState().listenTogether;
    expect(lt.active).toBe(false);
    expect(lt.pendingInvite?.djPubkey).toBe(OTHER);
    // …so the new DJ's controls now reach the invite
    handleIncomingMessage(msg("lt:seek", { position: 42 }), OTHER);
    expect(store.getState().listenTogether.pendingInvite?.position).toBe(42);
  });

  it("a dismissal follows the transfer too, so the new DJ's re-send stays quiet", () => {
    handleIncomingMessage(start(), DJ);
    dismissInvite();
    handleIncomingMessage(msg("lt:transfer_dj", { targetPubkey: OTHER }), DJ);
    handleIncomingMessage(start({ djPubkey: OTHER }), OTHER);
    expect(store.getState().listenTogether.dismissed).toBe(true);
  });

  it("only the inviter can retarget a pending invite", () => {
    handleIncomingMessage(start(), DJ);
    handleIncomingMessage(msg("lt:transfer_dj", { targetPubkey: OTHER }), OTHER);
    expect(store.getState().listenTogether.pendingInvite?.djPubkey).toBe(DJ);
  });

  it("taking over as DJ announces the session with lt:start", () => {
    joinAsListener();
    publishData.mockClear();
    handleIncomingMessage(msg("lt:transfer_dj", { targetPubkey: ME }), DJ);
    expect(store.getState().listenTogether.isLocalDJ).toBe(true);
    const sent = sentTypes();
    expect(sent).toContain("lt:start");
    const startMsg = JSON.parse(new TextDecoder().decode(publishData.mock.calls[sent.indexOf("lt:start")][0]));
    expect(startMsg.data.djPubkey).toBe(ME);
  });

  it("rejects an lt:start whose djPubkey isn't the sender", () => {
    handleIncomingMessage(
      msg("lt:start", { djPubkey: DJ, trackId: null, queue: [], queueIndex: 0, position: 0, isPlaying: false, trackMeta: null }),
      OTHER,
    );
    expect(store.getState().listenTogether.pendingInvite).toBeNull();
  });

  it("doesn't let another participant's lt:start take over a running session", () => {
    joinAsListener();
    handleIncomingMessage(
      msg("lt:start", { djPubkey: OTHER, trackId: null, queue: [], queueIndex: 0, position: 0, isPlaying: false, trackMeta: null }),
      OTHER,
    );
    expect(store.getState().listenTogether.pendingInvite).toBeNull();
    expect(store.getState().listenTogether.djPubkey).toBe(DJ);
  });

  it("only the invite's DJ can update or cancel a pending invite", () => {
    handleIncomingMessage(
      msg("lt:start", { djPubkey: DJ, trackId: T1, queue: [T1], queueIndex: 0, position: 5, isPlaying: true, trackMeta: meta() }),
      DJ,
    );
    handleIncomingMessage(msg("lt:seek", { position: 99 }), OTHER);
    handleIncomingMessage(msg("lt:end"), OTHER);
    expect(store.getState().listenTogether.pendingInvite?.position).toBe(5);

    handleIncomingMessage(msg("lt:end"), DJ);
    expect(store.getState().listenTogether.pendingInvite).toBeNull();
  });

  it("attributes listener messages to the sender, not the payload", () => {
    joinAsListener("dm"); // no skip threshold in DMs — the vote stays visible
    handleIncomingMessage(msg("lt:vote_skip", { voterPubkey: DJ }), OTHER);
    handleIncomingMessage(msg("lt:join", { pubkey: DJ }), OTHER);
    const lt = store.getState().listenTogether;
    expect(lt.skipVotes).toEqual([OTHER]);
    expect(lt.listeners).toContain(OTHER);
  });
});

describe("leaving", () => {
  it("ends the session when the DJ leaves the room", () => {
    joinAsListener();
    handleParticipantLeft(DJ);
    expect(store.getState().listenTogether.active).toBe(false);
  });

  it("drops a departing listener and their skip vote, keeping the session", () => {
    joinAsListener("dm");
    handleIncomingMessage(msg("lt:join"), OTHER);
    handleIncomingMessage(msg("lt:vote_skip"), OTHER);
    handleParticipantLeft(OTHER);
    const lt = store.getState().listenTogether;
    expect(lt.active).toBe(true);
    expect(lt.listeners).not.toContain(OTHER);
    expect(lt.skipVotes).toEqual([]);
  });

  it("clears a pending invite whose DJ left", () => {
    handleIncomingMessage(
      msg("lt:start", { djPubkey: DJ, trackId: null, queue: [], queueIndex: 0, position: 0, isPlaying: false, trackMeta: null }),
      DJ,
    );
    handleParticipantLeft(DJ);
    expect(store.getState().listenTogether.pendingInvite).toBeNull();
  });

  it("the DJ sends lt:end before leaving", async () => {
    store.dispatch(startSession({ context: "space", roomId: "r", djPubkey: ME, isLocalDJ: true }));
    await announceListenTogetherExit();
    expect(sentTypes()).toEqual(["lt:end"]);
    expect(store.getState().listenTogether.active).toBe(false);
  });

  it("a listener sends lt:leave before leaving", async () => {
    joinAsListener();
    await announceListenTogetherExit();
    expect(sentTypes()).toEqual(["lt:leave"]);
  });

  it("a stalled publish can't hold up leaving", async () => {
    vi.useFakeTimers();
    try {
      publishData.mockImplementationOnce(() => new Promise(() => {}));
      store.dispatch(startSession({ context: "space", roomId: "r", djPubkey: ME, isLocalDJ: true }));
      const done = announceListenTogetherExit();
      await vi.advanceTimersByTimeAsync(600);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sync", () => {
  it("joins mid-track at the DJ's anchored position, not 0:00", () => {
    const now = Date.now();
    store.dispatch(
      setPendingInvite({
        djPubkey: DJ, context: "space", roomId: "r",
        trackId: T1, trackMeta: meta(), queue: [T1], queueIndex: 0,
        position: 42, isPlaying: true, ts: now - 1000,
      }),
    );
    joinListenTogetherSession();
    expect(seekTrackTo).toHaveBeenCalledWith(T1, 42, { at: now - 1000 });
    expect(store.getState().music.player.isPlaying).toBe(true);
  });

  it("joins a paused session paused", () => {
    store.dispatch(
      setPendingInvite({
        djPubkey: DJ, context: "space", roomId: "r",
        trackId: T1, trackMeta: meta(), queue: [T1], queueIndex: 0,
        position: 42, isPlaying: false, ts: Date.now(),
      }),
    );
    joinListenTogetherSession();
    expect(store.getState().music.player.isPlaying).toBe(false);
  });

  it("treats lt:play for the current track as a sync, not a reload", () => {
    joinAsListener();
    const before = store.getState().music.player;
    handleIncomingMessage(msg("lt:play", { trackId: T1, position: 0, queue: [T1], queueIndex: 0, trackMeta: meta() }), DJ);
    expect(store.getState().music.player.currentTrackId).toBe(before.currentTrackId);
    expect(seekTrackTo).toHaveBeenCalledWith(T1, 0, expect.objectContaining({ tolerance: 0.3 }));
  });

  it("loads a new track from lt:play without a drift tolerance", () => {
    joinAsListener();
    handleIncomingMessage(msg("lt:play", { trackId: T2, position: 0, queue: [T1, T2], queueIndex: 1, trackMeta: meta() }), DJ);
    expect(store.getState().music.player.currentTrackId).toBe(T2);
    expect(seekTrackTo).toHaveBeenCalledWith(T2, 0, expect.objectContaining({ tolerance: undefined }));
  });

  it("gates heartbeat seeks behind the drift tolerance", () => {
    joinAsListener();
    handleIncomingMessage(msg("lt:seek", { position: 30 }), DJ);
    expect(seekTrackTo).toHaveBeenCalledWith(T1, 30, expect.objectContaining({ tolerance: 1 }));
  });

  it("clamps latency compensation against clock skew", () => {
    const now = 1_000_000;
    expect(anchorTime(now - 200, now)).toBe(now - 200);
    expect(anchorTime(now - 60_000, now)).toBe(now - MAX_LATENCY_MS);
    expect(anchorTime(now + 60_000, now)).toBe(now);
  });
});

describe("gated tracks", () => {
  function playUnknown(trackMeta: TrackMeta) {
    joinAsListener();
    handleIncomingMessage(msg("lt:play", { trackId: T2, position: 0, queue: [T2], queueIndex: 0, trackMeta }), DJ);
    return store.getState().music.tracks[T2];
  }

  it("takes a members-only track's visibility from the DJ's hint", () => {
    const t = playUnknown(meta({ visibility: "space" }));
    expect(t.visibility).toBe("space");
    expect(t.accessUnknown).toBe(false);
  });

  it("marks a track without a hint for an access probe", () => {
    const t = playUnknown(meta());
    expect(t.visibility).toBe("public");
    expect(t.accessUnknown).toBe(true);
  });

  it("sends the track's visibility when DJing, mapping local to private", () => {
    store.dispatch(addTrack(track(T1, "local")));
    store.dispatch(setCurrentTrack({ trackId: T1, queue: [T1], queueIndex: 0 }));
    store.dispatch(startSession({ context: "space", roomId: "r", djPubkey: ME, isLocalDJ: true }));
    // A late joiner triggers a full lt:start re-send.
    return import("../listenTogetherService").then(({ broadcastSessionToLateJoiner }) => {
      broadcastSessionToLateJoiner();
      const sent = JSON.parse(new TextDecoder().decode(publishData.mock.calls[0][0]));
      expect(sent.data.trackMeta.visibility).toBe("private");
    });
  });
});

const start = (extra: Record<string, unknown> = {}) =>
  msg("lt:start", { djPubkey: DJ, trackId: T1, queue: [T1], queueIndex: 0, position: 0, isPlaying: true, trackMeta: meta(), ...extra });

describe("invite nagging", () => {
  it("a re-sent lt:start keeps a dismissed invite dismissed", () => {
    handleIncomingMessage(start(), DJ);
    dismissInvite();
    handleIncomingMessage(start({ position: 30 }), DJ);
    const lt = store.getState().listenTogether;
    expect(lt.dismissed).toBe(true);
    expect(lt.pendingInvite?.position).toBe(30); // still refreshed for a later Join
  });

  it("a re-sent lt:start doesn't re-invite someone who left the session", () => {
    handleIncomingMessage(start(), DJ);
    joinListenTogetherSession();
    leaveListenTogetherSession();
    handleIncomingMessage(start(), DJ);
    expect(store.getState().listenTogether.dismissed).toBe(true);
  });

  it("a new session after that DJ's lt:end invites again", () => {
    handleIncomingMessage(start(), DJ);
    dismissInvite();
    handleIncomingMessage(msg("lt:end"), DJ);
    handleIncomingMessage(start(), DJ);
    expect(store.getState().listenTogether.dismissed).toBe(false);
  });

  it("a different DJ's session invites again", () => {
    handleIncomingMessage(start(), DJ);
    dismissInvite();
    handleIncomingMessage(start({ djPubkey: OTHER }), OTHER);
    const lt = store.getState().listenTogether;
    expect(lt.dismissed).toBe(false);
    expect(lt.pendingInvite?.djPubkey).toBe(OTHER);
  });
});

describe("suggestions", () => {
  function beDJ() {
    store.dispatch(addTrack(track(T1)));
    store.dispatch(setCurrentTrack({ trackId: T1, queue: [T1], queueIndex: 0 }));
    store.dispatch(startSession({ context: "space", roomId: "r", djPubkey: ME, isLocalDJ: true }));
  }

  it("a listener sends lt:suggest with the track's metadata", () => {
    joinAsListener();
    store.dispatch(addTrack(track(T2, "space")));
    expect(suggestTrack(T2)).toBe(true);
    const sent = JSON.parse(new TextDecoder().decode(publishData.mock.calls[0][0]));
    expect(sent.type).toBe("lt:suggest");
    expect(sent.data).toMatchObject({ trackId: T2, trackMeta: { visibility: "space" } });
  });

  it("can't suggest a track without metadata", () => {
    joinAsListener();
    expect(suggestTrack(T2)).toBe(false);
    expect(publishData).not.toHaveBeenCalled();
  });

  it("the DJ collects suggestions under the sender's identity", () => {
    beDJ();
    handleIncomingMessage(msg("lt:suggest", { trackId: T2, trackMeta: meta() }), OTHER);
    expect(store.getState().listenTogether.suggestions).toEqual([
      expect.objectContaining({ trackId: T2, from: OTHER }),
    ]);
  });

  it("listeners ignore suggestions", () => {
    joinAsListener();
    handleIncomingMessage(msg("lt:suggest", { trackId: T2, trackMeta: meta() }), OTHER);
    expect(store.getState().listenTogether.suggestions).toEqual([]);
  });

  it("accepting queues the track and broadcasts the queue", () => {
    beDJ();
    handleIncomingMessage(msg("lt:suggest", { trackId: T2, trackMeta: meta() }), OTHER);
    acceptSuggestion(T2);
    const s = store.getState();
    expect(s.music.player.queue).toEqual([T1, T2]);
    expect(s.music.tracks[T2]).toBeDefined();
    expect(s.listenTogether.suggestions).toEqual([]);
    expect(sentTypes()).toContain("lt:queue");
  });

  it("accepting an already-queued track only clears it from the inbox", () => {
    beDJ();
    handleIncomingMessage(msg("lt:suggest", { trackId: T1, trackMeta: meta() }), OTHER);
    publishData.mockClear();
    acceptSuggestion(T1);
    expect(store.getState().music.player.queue).toEqual([T1]);
    expect(store.getState().listenTogether.suggestions).toEqual([]);
    expect(publishData).not.toHaveBeenCalled();
  });
});

describe("queue updates", () => {
  it("re-finds the current track in a replaced (windowed) queue", () => {
    joinAsListener();
    handleIncomingMessage(msg("lt:queue", { queue: [T2, T1] }), DJ);
    const s = store.getState();
    expect(s.music.player.queueIndex).toBe(1);
    expect(s.listenTogether.sharedQueueIndex).toBe(1);
    expect(s.music.player.isPlaying).toBe(true);
  });
});

describe("decoding", () => {
  const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

  it("drops a packet missing what its type promises", () => {
    expect(decodeLTMessage(enc({ type: "lt:play", ts: 1, dj: DJ, data: { trackId: T1, position: 0, queue: [T1] } }))).toBeNull();
    expect(decodeLTMessage(enc({ type: "lt:start", ts: 1, dj: DJ, data: { djPubkey: DJ, queue: null, position: 0 } }))).toBeNull();
  });

  it("keeps a well-formed packet", () => {
    const m = decodeLTMessage(enc({ type: "lt:seek", ts: 1, dj: DJ, data: { position: 4 } }));
    expect(m).toEqual({ type: "lt:seek", ts: 1, dj: DJ, data: { position: 4 } });
  });
});

describe("DJ end of queue", () => {
  function djWithQueue(queue: string[]) {
    for (const id of queue) store.dispatch(addTrack(track(id)));
    store.dispatch(setCurrentTrack({ trackId: queue[0], queue, queueIndex: 0 }));
    void startListenTogetherSession("r", "space");
    publishData.mockClear();
  }
  const sent = () => publishData.mock.calls.map(([p]) => JSON.parse(new TextDecoder().decode(p)));

  it("pauses everyone at the end of the last track instead of replaying it", () => {
    djWithQueue([T1]);
    store.dispatch(setDuration(200));
    store.dispatch(nextTrack());
    expect(sent().map((m) => m.type)).toEqual(["lt:pause"]);
    expect(sent()[0].data.position).toBe(200);
  });

  it("still advances mid-queue", () => {
    djWithQueue([T1, T2]);
    store.dispatch(nextTrack());
    expect(sent().map((m) => m.type)).toEqual(["lt:next", "lt:play"]);
    expect(sent()[1].data.trackId).toBe(T2);
  });

  it("play after the queue ran out restarts from 0, not the end", () => {
    djWithQueue([T1]);
    store.dispatch(setDuration(200));
    store.dispatch(updatePosition(199.8));
    store.dispatch(nextTrack()); // queue ran out → paused
    publishData.mockClear();
    store.dispatch(togglePlay());
    expect(sent()[0]).toMatchObject({ type: "lt:play", data: { position: 0 } });
  });
});
