import { store } from "@/store";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";
import {
  startSession,
  endSession,
  setPendingInvite,
  updatePendingInvite,
  setDismissed,
  setDJ,
  setSharedQueue,
  setLTCurrentTrack,
  setLTIsPlaying,
  setLTPosition,
  addSkipVote,
  clearSkipVotes,
  addReaction,
  addListener,
  removeListener,
} from "@/store/slices/listenTogetherSlice";
import {
  setCurrentTrack,
  setIsPlaying,
  updatePosition,
  setQueue,
  nextTrack,
  prevTrack,
  addTrack,
} from "@/store/slices/musicSlice";
import {
  createLTMessage,
  encodeLTMessage,
  LISTEN_TOGETHER_TOPIC,
  type LTMessage,
  type LTStartPayload,
  type LTPlayPayload,
  type LTPausePayload,
  type LTSeekPayload,
  type LTQueuePayload,
  type LTTransferDJPayload,
  type LTRequestDJPayload,
  type LTVoteSkipPayload,
  type LTReactionPayload,
  type LTJoinPayload,
  type LTLeavePayload,
  type TrackMeta,
} from "./syncProtocol";
import { getAudio } from "@/features/music/useAudioPlayer";
import { upgradeToSfuForListenTogether } from "@/features/calling/callService";
import type { MusicTrack } from "@/types/music";

// ── Guard flag: prevents middleware from re-broadcasting actions
//    that came from an incoming LT message ─────────────────────────
let _isApplyingRemote = false;

export function isApplyingRemote(): boolean {
  return _isApplyingRemote;
}

// ── Broadcast helper ──────────────────────────────────────────────

function broadcast(msg: LTMessage): void {
  const room = getLivekitRoom();
  if (!room) return;

  const payload = encodeLTMessage(msg);
  room.localParticipant.publishData(payload, {
    reliable: true,
    topic: LISTEN_TOGETHER_TOPIC,
  });
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Start a Listen Together session. Caller becomes the DJ.
 * In DM context, auto-upgrades P2P call to SFU for DataChannel access.
 */
export async function startListenTogetherSession(
  roomId: string,
  context: "space" | "dm",
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  // DM calls: ensure SFU mode for DataChannel
  if (context === "dm") {
    await upgradeToSfuForListenTogether();
  }

  const musicPlayer = store.getState().music.player;
  const tracks = store.getState().music.tracks;
  const currentTrack = musicPlayer.currentTrackId
    ? tracks[musicPlayer.currentTrackId]
    : null;

  store.dispatch(
    startSession({
      context,
      roomId,
      djPubkey: myPubkey,
      isLocalDJ: true,
    }),
  );

  // Sync current player state to shared state
  if (musicPlayer.currentTrackId) {
    store.dispatch(
      setSharedQueue({
        queue: musicPlayer.queue,
        queueIndex: musicPlayer.queueIndex,
      }),
    );
    store.dispatch(
      setLTCurrentTrack({
        trackId: musicPlayer.currentTrackId,
        isPlaying: musicPlayer.isPlaying,
        position: musicPlayer.position,
      }),
    );
  }

  const payload: LTStartPayload = {
    djPubkey: myPubkey,
    trackId: musicPlayer.currentTrackId,
    queue: musicPlayer.queue,
    queueIndex: musicPlayer.queueIndex,
    position: musicPlayer.position,
    isPlaying: musicPlayer.isPlaying,
    trackMeta: currentTrack ? buildTrackMeta(currentTrack) : null,
  };

  broadcast(createLTMessage("lt:start", myPubkey, payload as unknown as Record<string, unknown>));
}

/**
 * End the current Listen Together session.
 */
export function endListenTogetherSession(): void {
  const lt = store.getState().listenTogether;
  if (!lt.active) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  broadcast(createLTMessage("lt:end", lt.djPubkey ?? myPubkey, {}));
  store.dispatch(endSession());
}

/**
 * Accept a pending invite and join the Listen Together session.
 */
export function joinListenTogetherSession(): void {
  const lt = store.getState().listenTogether;
  const invite = lt.pendingInvite;
  if (!invite || lt.active) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  // Activate session as a listener
  store.dispatch(
    startSession({
      context: invite.context,
      roomId: invite.roomId,
      djPubkey: invite.djPubkey,
      isLocalDJ: false,
    }),
  );

  // Apply playback state
  _isApplyingRemote = true;
  try {
    if (invite.queue.length > 0) {
      store.dispatch(
        setSharedQueue({ queue: invite.queue, queueIndex: invite.queueIndex }),
      );
    }

    if (invite.trackId && invite.trackMeta) {
      ensureTrackAvailable(invite.trackId, invite.trackMeta);
      store.dispatch(
        setCurrentTrack({
          trackId: invite.trackId,
          queue: invite.queue,
          queueIndex: invite.queueIndex,
        }),
      );
      store.dispatch(
        setLTCurrentTrack({
          trackId: invite.trackId,
          isPlaying: invite.isPlaying,
          position: invite.position,
        }),
      );

      // Seek to DJ's position with latency compensation
      const latencySeconds = (Date.now() - invite.ts) / 1000;
      const compensatedPosition = invite.position + latencySeconds;
      seekAudioTo(compensatedPosition);
      if (invite.isPlaying) {
        store.dispatch(setIsPlaying(true));
      }
    }
  } finally {
    _isApplyingRemote = false;
  }

  // Broadcast join so all participants update their listener lists
  const joinPayload: LTJoinPayload = { pubkey: myPubkey };
  broadcast(
    createLTMessage("lt:join", invite.djPubkey, joinPayload as unknown as Record<string, unknown>),
  );
}

/**
 * Leave the Listen Together session (non-DJ only).
 * Stays in voice channel but stops receiving music sync.
 */
export function leaveListenTogetherSession(): void {
  const lt = store.getState().listenTogether;
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  if (lt.active && !lt.isLocalDJ) {
    const leavePayload: LTLeavePayload = { pubkey: myPubkey };
    broadcast(
      createLTMessage("lt:leave", lt.djPubkey ?? "", leavePayload as unknown as Record<string, unknown>),
    );
  }

  store.dispatch(endSession());
  // Mark dismissed so we don't show the invite banner again for this session
  store.dispatch(setDismissed(true));
}

/**
 * Dismiss the invite banner without joining.
 * User can still join later via the voice controls.
 */
export function dismissInvite(): void {
  store.dispatch(setDismissed(true));
}

/**
 * Clean up Listen Together state (called on voice disconnect / call hangup).
 */
export function cleanupListenTogether(): void {
  const lt = store.getState().listenTogether;
  if (lt.active && lt.isLocalDJ) {
    endListenTogetherSession();
  } else if (lt.active) {
    leaveListenTogetherSession();
  }
  store.dispatch(endSession());
}

/**
 * DJ re-broadcasts current session state to a late joiner.
 * Called when a new participant connects to the LiveKit room.
 */
export function broadcastSessionToLateJoiner(): void {
  const lt = store.getState().listenTogether;
  if (!lt.active || !lt.isLocalDJ) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  const musicPlayer = store.getState().music.player;
  const tracks = store.getState().music.tracks;
  const currentTrack = musicPlayer.currentTrackId
    ? tracks[musicPlayer.currentTrackId]
    : null;

  const payload: LTStartPayload = {
    djPubkey: myPubkey,
    trackId: musicPlayer.currentTrackId,
    queue: musicPlayer.queue,
    queueIndex: musicPlayer.queueIndex,
    position: musicPlayer.position,
    isPlaying: musicPlayer.isPlaying,
    trackMeta: currentTrack ? buildTrackMeta(currentTrack) : null,
  };

  broadcast(createLTMessage("lt:start", myPubkey, payload as unknown as Record<string, unknown>));
}

/**
 * Transfer DJ role to another participant.
 */
export function transferDJ(targetPubkey: string): void {
  const lt = store.getState().listenTogether;
  if (!lt.active || !lt.isLocalDJ) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  const payload: LTTransferDJPayload = { targetPubkey };
  broadcast(createLTMessage("lt:transfer_dj", myPubkey, payload as unknown as Record<string, unknown>));

  store.dispatch(
    setDJ({ pubkey: targetPubkey, isLocal: false }),
  );
}

/**
 * Request to become the DJ.
 */
export function requestDJ(): void {
  const lt = store.getState().listenTogether;
  if (!lt.active || lt.isLocalDJ) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  broadcast(
    createLTMessage("lt:request_dj", lt.djPubkey ?? "", {
      requesterPubkey: myPubkey,
    } as unknown as Record<string, unknown>),
  );
}

/**
 * Vote to skip the current track.
 */
export function voteSkip(): void {
  const lt = store.getState().listenTogether;
  if (!lt.active) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  broadcast(
    createLTMessage("lt:vote_skip", lt.djPubkey ?? "", {
      voterPubkey: myPubkey,
    } as unknown as Record<string, unknown>),
  );

  store.dispatch(addSkipVote(myPubkey));
  checkSkipThreshold();
}

/**
 * Send a reaction emoji.
 */
export function sendReaction(emoji: string): void {
  const lt = store.getState().listenTogether;
  if (!lt.active) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  const reaction: LTReactionPayload = { emoji, senderPubkey: myPubkey };
  broadcast(
    createLTMessage("lt:reaction", lt.djPubkey ?? "", reaction as unknown as Record<string, unknown>),
  );

  store.dispatch(addReaction({ pubkey: myPubkey, emoji, ts: Date.now() }));
}

// ── DJ-side broadcast helpers (called by middleware) ───────────────

export function broadcastPlay(
  trackId: string,
  position: number,
  queue: string[],
  queueIndex: number,
): void {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  const track = store.getState().music.tracks[trackId];
  if (!track) return;

  const payload: LTPlayPayload = {
    trackId,
    position,
    queue,
    queueIndex,
    trackMeta: buildTrackMeta(track),
  };

  broadcast(createLTMessage("lt:play", myPubkey, payload as unknown as Record<string, unknown>));

  store.dispatch(
    setSharedQueue({ queue, queueIndex }),
  );
  store.dispatch(
    setLTCurrentTrack({ trackId, isPlaying: true, position }),
  );
}

export function broadcastPause(position: number): void {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  const payload: LTPausePayload = { position };
  broadcast(createLTMessage("lt:pause", myPubkey, payload as unknown as Record<string, unknown>));

  store.dispatch(setLTIsPlaying(false));
  store.dispatch(setLTPosition(position));
}

export function broadcastResume(position: number): void {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  // Reuse lt:play with current track info
  const lt = store.getState().listenTogether;
  if (!lt.currentTrackId) return;

  const track = store.getState().music.tracks[lt.currentTrackId];
  if (!track) return;

  const payload: LTPlayPayload = {
    trackId: lt.currentTrackId,
    position,
    queue: lt.sharedQueue,
    queueIndex: lt.sharedQueueIndex,
    trackMeta: buildTrackMeta(track),
  };

  broadcast(createLTMessage("lt:play", myPubkey, payload as unknown as Record<string, unknown>));
  store.dispatch(setLTIsPlaying(true));
  store.dispatch(setLTPosition(position));
}

export function broadcastSeek(position: number): void {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  const payload: LTSeekPayload = { position };
  broadcast(createLTMessage("lt:seek", myPubkey, payload as unknown as Record<string, unknown>));
  store.dispatch(setLTPosition(position));
}

export function broadcastNext(): void {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  broadcast(createLTMessage("lt:next", myPubkey, {}));
}

export function broadcastPrev(): void {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  broadcast(createLTMessage("lt:prev", myPubkey, {}));
}

export function broadcastQueue(queue: string[]): void {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  const payload: LTQueuePayload = { queue };
  broadcast(createLTMessage("lt:queue", myPubkey, payload as unknown as Record<string, unknown>));
}

// ── Incoming message handler ──────────────────────────────────────

export function handleIncomingMessage(
  msg: LTMessage,
  senderPubkey: string,
): void {
  const myPubkey = store.getState().identity.pubkey;
  // Ignore our own messages
  if (senderPubkey === myPubkey) return;

  _isApplyingRemote = true;
  try {
    switch (msg.type) {
      case "lt:start":
        handleStart(msg.data as unknown as LTStartPayload, senderPubkey, msg.ts);
        break;
      case "lt:end":
        handleEnd();
        break;
      case "lt:play":
        handlePlay(msg);
        break;
      case "lt:pause":
        handlePause(msg.data as unknown as LTPausePayload);
        break;
      case "lt:seek":
        handleSeek(msg);
        break;
      case "lt:queue":
        handleQueue(msg.data as unknown as LTQueuePayload);
        break;
      case "lt:next":
        handleNext();
        break;
      case "lt:prev":
        handlePrev();
        break;
      case "lt:transfer_dj":
        handleTransferDJ(msg.data as unknown as LTTransferDJPayload);
        break;
      case "lt:request_dj":
        handleRequestDJ(msg.data as unknown as LTRequestDJPayload);
        break;
      case "lt:vote_skip":
        handleVoteSkip(msg.data as unknown as LTVoteSkipPayload);
        break;
      case "lt:reaction":
        handleReaction(msg.data as unknown as LTReactionPayload);
        break;
      case "lt:join":
        handleJoin(msg.data as unknown as LTJoinPayload);
        break;
      case "lt:leave":
        handleLeave(msg.data as unknown as LTLeavePayload);
        break;
    }
  } finally {
    _isApplyingRemote = false;
  }
}

// ── Internal handlers ─────────────────────────────────────────────

function handleStart(payload: LTStartPayload, _senderPubkey: string, msgTs: number): void {
  const lt = store.getState().listenTogether;

  // If we're already active in this session (e.g. we're the DJ), ignore
  if (lt.active && lt.djPubkey === payload.djPubkey) return;

  // Determine context from current state
  const context: "space" | "dm" =
    lt.context ?? (store.getState().voice.connectedRoom ? "space" : "dm");

  const roomId =
    lt.roomId ??
    store.getState().voice.connectedRoom?.channelId ??
    store.getState().call.activeCall?.roomId ??
    "";

  // If user was previously dismissed and DJ restarts, reset dismissed
  if (lt.dismissed) {
    store.dispatch(setDismissed(false));
  }

  // Set as pending invite — user must explicitly accept
  store.dispatch(
    setPendingInvite({
      djPubkey: payload.djPubkey,
      context,
      roomId,
      trackId: payload.trackId,
      trackMeta: payload.trackMeta,
      queue: payload.queue,
      queueIndex: payload.queueIndex,
      position: payload.position,
      isPlaying: payload.isPlaying,
      ts: msgTs,
    }),
  );
}

function handleEnd(): void {
  store.dispatch(endSession());
}

function handlePlay(msg: LTMessage): void {
  const lt = store.getState().listenTogether;
  const payload = msg.data as unknown as LTPlayPayload;

  // If not in the session, update the pending invite metadata
  if (!lt.active) {
    if (lt.pendingInvite || !lt.dismissed) {
      store.dispatch(
        updatePendingInvite({
          trackId: payload.trackId,
          trackMeta: payload.trackMeta,
          position: payload.position,
          isPlaying: true,
          queue: payload.queue,
          queueIndex: payload.queueIndex,
          ts: msg.ts,
        }),
      );
      // If no invite yet (maybe lt:start was missed), create one
      if (!lt.pendingInvite && !lt.dismissed) {
        const context: "space" | "dm" =
          store.getState().voice.connectedRoom ? "space" : "dm";
        const roomId =
          store.getState().voice.connectedRoom?.channelId ??
          store.getState().call.activeCall?.roomId ??
          "";
        store.dispatch(
          setPendingInvite({
            djPubkey: msg.dj,
            context,
            roomId,
            trackId: payload.trackId,
            trackMeta: payload.trackMeta,
            queue: payload.queue,
            queueIndex: payload.queueIndex,
            position: payload.position,
            isPlaying: true,
            ts: msg.ts,
          }),
        );
      }
    }
    return;
  }

  ensureTrackAvailable(payload.trackId, payload.trackMeta);

  // Latency-compensated position
  const latencySeconds = (Date.now() - msg.ts) / 1000;
  const compensatedPosition = payload.position + latencySeconds;

  store.dispatch(
    setCurrentTrack({
      trackId: payload.trackId,
      queue: payload.queue,
      queueIndex: payload.queueIndex,
    }),
  );
  store.dispatch(setIsPlaying(true));

  store.dispatch(
    setSharedQueue({ queue: payload.queue, queueIndex: payload.queueIndex }),
  );
  store.dispatch(
    setLTCurrentTrack({
      trackId: payload.trackId,
      isPlaying: true,
      position: compensatedPosition,
    }),
  );
  store.dispatch(clearSkipVotes());

  // Seek audio to compensated position after track loads
  seekAudioTo(compensatedPosition);
}

function handlePause(payload: LTPausePayload): void {
  const lt = store.getState().listenTogether;

  if (!lt.active) {
    store.dispatch(updatePendingInvite({ position: payload.position, isPlaying: false }));
    return;
  }

  store.dispatch(setIsPlaying(false));
  store.dispatch(setLTIsPlaying(false));
  store.dispatch(setLTPosition(payload.position));
  seekAudioTo(payload.position);
}

function handleSeek(msg: LTMessage): void {
  const lt = store.getState().listenTogether;
  const payload = msg.data as unknown as LTSeekPayload;

  if (!lt.active) {
    const latencySeconds = (Date.now() - msg.ts) / 1000;
    store.dispatch(updatePendingInvite({ position: payload.position + latencySeconds }));
    return;
  }

  const latencySeconds = (Date.now() - msg.ts) / 1000;
  const compensatedPosition = payload.position + latencySeconds;

  seekAudioTo(compensatedPosition);
  store.dispatch(updatePosition(compensatedPosition));
  store.dispatch(setLTPosition(compensatedPosition));
}

function handleQueue(payload: LTQueuePayload): void {
  const lt = store.getState().listenTogether;

  if (!lt.active) {
    store.dispatch(updatePendingInvite({ queue: payload.queue }));
    return;
  }

  store.dispatch(setQueue(payload.queue));
  store.dispatch(
    setSharedQueue({
      queue: payload.queue,
      queueIndex: store.getState().listenTogether.sharedQueueIndex,
    }),
  );
}

function handleNext(): void {
  const lt = store.getState().listenTogether;
  if (!lt.active) return;

  store.dispatch(nextTrack());
}

function handlePrev(): void {
  const lt = store.getState().listenTogether;
  if (!lt.active) return;

  store.dispatch(prevTrack());
}

function handleTransferDJ(payload: LTTransferDJPayload): void {
  const myPubkey = store.getState().identity.pubkey;
  store.dispatch(
    setDJ({
      pubkey: payload.targetPubkey,
      isLocal: payload.targetPubkey === myPubkey,
    }),
  );
}

function handleRequestDJ(payload: LTRequestDJPayload): void {
  const lt = store.getState().listenTogether;
  // Auto-accept in DM context (either party can toggle DJ freely)
  if (lt.context === "dm" && lt.isLocalDJ) {
    transferDJ(payload.requesterPubkey);
  }
  // In spaces, request is logged but DJ must explicitly accept (future UI)
}

function handleVoteSkip(payload: LTVoteSkipPayload): void {
  store.dispatch(addSkipVote(payload.voterPubkey));
  checkSkipThreshold();
}

function handleReaction(payload: LTReactionPayload): void {
  store.dispatch(
    addReaction({
      pubkey: payload.senderPubkey,
      emoji: payload.emoji,
      ts: Date.now(),
    }),
  );
}

function handleJoin(payload: LTJoinPayload): void {
  store.dispatch(addListener(payload.pubkey));
}

function handleLeave(payload: LTLeavePayload): void {
  store.dispatch(removeListener(payload.pubkey));
}

// ── Utilities ─────────────────────────────────────────────────────

function buildTrackMeta(track: MusicTrack): TrackMeta {
  return {
    title: track.title,
    artist: track.artist,
    imageUrl: track.imageUrl,
    variants: track.variants,
  };
}

/**
 * Ensure a track exists in Redux. If not, create a minimal entry from metadata.
 */
function ensureTrackAvailable(trackId: string, meta: TrackMeta): void {
  const existing = store.getState().music.tracks[trackId];
  if (existing) return;

  // Build a minimal MusicTrack from the metadata
  const [, pubkey] = trackId.split(":");
  store.dispatch(
    addTrack({
      addressableId: trackId,
      eventId: "",
      pubkey: pubkey ?? "",
      title: meta.title,
      artist: meta.artist,
      artistPubkeys: [],
      featuredArtists: [],
      duration: undefined,
      genre: undefined,
      hashtags: [],
      variants: meta.variants,
      imageUrl: meta.imageUrl,
      createdAt: Math.floor(Date.now() / 1000),
      visibility: "public",
    }),
  );
}

function seekAudioTo(position: number): void {
  // Wait a tick for track to potentially load
  setTimeout(() => {
    const audio = getAudio();
    if (audio.src && isFinite(position) && position >= 0) {
      audio.currentTime = position;
    }
  }, 50);
}

function checkSkipThreshold(): void {
  const lt = store.getState().listenTogether;
  if (!lt.active || lt.context !== "space") return;

  // >50% of listeners voted skip
  const threshold = Math.ceil(lt.listeners.length / 2);
  if (lt.skipVotes.length >= threshold) {
    if (lt.isLocalDJ) {
      store.dispatch(nextTrack());
    }
    store.dispatch(clearSkipVotes());
  }
}
