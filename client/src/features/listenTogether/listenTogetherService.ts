import { store } from "@/store";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";
import {
  startSession,
  endSession,
  setPendingInvite,
  updatePendingInvite,
  clearPendingInvite,
  retargetPendingSession,
  setDismissed,
  dismissSession,
  setDJ,
  setSharedQueue,
  setLTCurrentTrack,
  setLTIsPlaying,
  setLTPosition,
  addSkipVote,
  removeSkipVote,
  clearSkipVotes,
  addReaction,
  addListener,
  removeListener,
  addSuggestion,
  removeSuggestion,
} from "@/store/slices/listenTogetherSlice";
import {
  setCurrentTrack,
  setIsPlaying,
  setQueue,
  nextTrack,
  prevTrack,
  addTrack,
  addToQueue,
} from "@/store/slices/musicSlice";
import { capLtQueue } from "@ishtarservices/core";
import { LT_SYNC_TOLERANCE_S, LT_GOODBYE_TIMEOUT_MS } from "@ishtarservices/shared-types";
import {
  createLTMessage,
  encodeLTMessage,
  LISTEN_TOGETHER_TOPIC,
  DJ_ONLY_TYPES,
  anchorTime,
  type LTMessage,
  type LTStartPayload,
  type LTPlayPayload,
  type LTPausePayload,
  type LTSeekPayload,
  type LTQueuePayload,
  type LTTransferDJPayload,
  type LTReactionPayload,
  type LTJoinPayload,
  type LTLeavePayload,
  type LTSuggestPayload,
  type TrackMeta,
} from "./syncProtocol";
import { seekTrackTo } from "@/features/music/useAudioPlayer";
import type { MusicTrack } from "@/types/music";

/** Heartbeat lt:seek: ignore drift below this (avoids audible skips). */
const HEARTBEAT_TOLERANCE_S = LT_SYNC_TOLERANCE_S;
/**
 * Explicit state changes (resume, pause) re-sync tighter — a seek at that
 * moment is inaudible, and a gap left there is never corrected by the
 * heartbeat gate. Mirrors mobile.
 */
const STATE_CHANGE_TOLERANCE_S = 0.3;
const GOODBYE_TIMEOUT_MS = LT_GOODBYE_TIMEOUT_MS;

// ── Guard flag: prevents middleware from re-broadcasting actions
//    that came from an incoming LT message ─────────────────────────
let _isApplyingRemote = false;

export function isApplyingRemote(): boolean {
  return _isApplyingRemote;
}

// ── Broadcast helper ──────────────────────────────────────────────

function broadcast(msg: LTMessage): Promise<void> {
  const room = getLivekitRoom();
  if (!room) return Promise.resolve();

  const payload = encodeLTMessage(msg);
  return room.localParticipant
    .publishData(payload, {
      reliable: true,
      topic: LISTEN_TOGETHER_TOPIC,
    })
    .catch((err: unknown) => {
      console.warn("[listenTogether] publish failed:", err);
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

  const musicPlayer = store.getState().music.player;

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

  broadcast(
    createLTMessage("lt:start", myPubkey, buildStartPayload(myPubkey) as unknown as Record<string, unknown>),
  );
}

/** The DJ's full session state, as sent in lt:start. */
function buildStartPayload(myPubkey: string): LTStartPayload {
  const musicPlayer = store.getState().music.player;
  // A track the listeners may not see is not announced at all (no id, no meta).
  const currentTrack = shareableTrack(musicPlayer.currentTrackId);
  const q = shareableQueue(musicPlayer.queue, musicPlayer.queueIndex);
  return {
    djPubkey: myPubkey,
    trackId: currentTrack ? musicPlayer.currentTrackId : null,
    ...capLtQueue(q.queue, q.queueIndex),
    position: musicPlayer.position,
    isPlaying: currentTrack ? musicPlayer.isPlaying : false,
    trackMeta: currentTrack ? buildTrackMeta(currentTrack) : null,
  };
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

      // setCurrentTrack starts playback; a paused session loads paused.
      if (!invite.isPlaying) store.dispatch(setIsPlaying(false));
      // The track is still loading — park the DJ's position (anchored at
      // `invite.ts`) so the load starts there instead of at 0:00.
      seekTrackTo(invite.trackId, invite.position, { at: invite.ts });
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
  store.dispatch(dismissSession(lt.djPubkey));
}

/**
 * Dismiss the invite banner without joining.
 * User can still join later via the voice controls.
 */
export function dismissInvite(): void {
  const invite = store.getState().listenTogether.pendingInvite;
  store.dispatch(dismissSession(invite?.djPubkey ?? null));
}

/**
 * Say goodbye before leaving the room: the DJ ends the session (lt:end), a
 * listener leaves it (lt:leave). Must run while the room is still connected —
 * from the Disconnected handler there is no transport left. Waits at most
 * GOODBYE_TIMEOUT_MS so a slow data channel can't hold up a hangup.
 */
export async function announceListenTogetherExit(): Promise<void> {
  const lt = store.getState().listenTogether;
  const myPubkey = store.getState().identity.pubkey;
  if (!lt.active || !myPubkey) return;

  const sent = lt.isLocalDJ
    ? broadcast(createLTMessage("lt:end", myPubkey, {}))
    : broadcast(
        createLTMessage("lt:leave", lt.djPubkey ?? "", {
          pubkey: myPubkey,
        } satisfies LTLeavePayload as unknown as Record<string, unknown>),
      );
  store.dispatch(endSession());
  await Promise.race([sent, new Promise((r) => setTimeout(r, GOODBYE_TIMEOUT_MS))]);
}

/**
 * Reset Listen Together state after the room is gone (voice disconnect / call
 * hangup). Local only — goodbyes go out in announceListenTogetherExit.
 */
export function cleanupListenTogether(): void {
  store.dispatch(endSession());
}

/**
 * A participant left the room. If it was the DJ, the session is over — this
 * is also the only signal when the DJ crashed or lost its connection.
 */
export function handleParticipantLeft(identity: string): void {
  const lt = store.getState().listenTogether;
  if (lt.active) {
    if (!lt.isLocalDJ && identity === lt.djPubkey) {
      store.dispatch(endSession());
    } else {
      store.dispatch(removeListener(identity));
      store.dispatch(removeSkipVote(identity));
    }
  } else {
    if (lt.pendingInvite?.djPubkey === identity) store.dispatch(clearPendingInvite());
    // Their session is over; a future one should invite again.
    if (lt.dismissedDJ === identity) store.dispatch(setDismissed(false));
  }
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

  broadcast(
    createLTMessage("lt:start", myPubkey, buildStartPayload(myPubkey) as unknown as Record<string, unknown>),
  );
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

/**
 * Suggest a track to the DJ (listener only). Needs the track's metadata so
 * the DJ can play it without the event — false when we don't have it.
 */
export function suggestTrack(trackId: string): boolean {
  const lt = store.getState().listenTogether;
  const myPubkey = store.getState().identity.pubkey;
  if (!lt.active || lt.isLocalDJ || !myPubkey) return false;

  const track = shareableTrack(trackId);
  if (!track || track.variants.length === 0) return false;

  const payload: LTSuggestPayload = { trackId, trackMeta: buildTrackMeta(track) };
  broadcast(
    createLTMessage("lt:suggest", lt.djPubkey ?? "", payload as unknown as Record<string, unknown>),
  );
  return true;
}

/**
 * DJ: queue a listener's suggestion (the middleware broadcasts lt:queue).
 * Already queued → just clears it from the inbox.
 */
export function acceptSuggestion(trackId: string): void {
  const lt = store.getState().listenTogether;
  if (!lt.active || !lt.isLocalDJ) return;
  const suggestion = lt.suggestions.find((s) => s.trackId === trackId);
  if (!suggestion) return;

  store.dispatch(removeSuggestion(trackId));
  if (store.getState().music.player.queue.includes(trackId)) return;
  ensureTrackAvailable(trackId, suggestion.trackMeta);
  store.dispatch(addToQueue(trackId));
}

/** DJ: drop a suggestion without queueing it. */
export function dismissSuggestion(trackId: string): void {
  store.dispatch(removeSuggestion(trackId));
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

  // Not shareable with this room's listeners → play locally only; listeners
  // keep whatever they had and get no title, cover, or blob URL.
  const track = shareableTrack(trackId);
  if (!track) return;

  const q = shareableQueue(queue, queueIndex);
  const payload: LTPlayPayload = {
    trackId,
    position,
    ...capLtQueue(q.queue, q.queueIndex),
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

  const track = shareableTrack(lt.currentTrackId);
  if (!track) return;

  const q = shareableQueue(lt.sharedQueue, lt.sharedQueueIndex);
  const payload: LTPlayPayload = {
    trackId: lt.currentTrackId,
    position,
    ...capLtQueue(q.queue, q.queueIndex),
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

  const { queue: capped } = capLtQueue(queue, store.getState().music.player.queueIndex);
  const payload: LTQueuePayload = { queue: capped };
  broadcast(createLTMessage("lt:queue", myPubkey, payload as unknown as Record<string, unknown>));
}

// ── Incoming message handler ──────────────────────────────────────

/**
 * The DJ whose controls we honor: the session's DJ once joined, else the DJ
 * of the invite we're holding (or the session we left — so its lt:end still
 * lands). null = no session known yet.
 */
function currentDJ(): string | null {
  const lt = store.getState().listenTogether;
  if (lt.active) return lt.djPubkey;
  return lt.pendingInvite?.djPubkey ?? lt.dismissedDJ ?? null;
}

/**
 * Whether `sender` may send this DJ-only message. `senderPubkey` is the
 * LiveKit participant identity (bound to the pubkey by the token server);
 * the envelope's `dj` field is self-reported and never trusted.
 */
function isAuthorizedDJMessage(msg: LTMessage, senderPubkey: string): boolean {
  const lt = store.getState().listenTogether;
  const dj = currentDJ();

  if (msg.type === "lt:start") {
    const payload = msg.data as unknown as LTStartPayload;
    if (payload?.djPubkey !== senderPubkey) return false;
    // A running session isn't taken over by someone else's lt:start.
    return !lt.active || dj === senderPubkey;
  }
  // A missed lt:start: the first lt:play may open the invite.
  if (msg.type === "lt:play" && dj === null) return true;
  return dj !== null && dj === senderPubkey;
}

export function handleIncomingMessage(
  msg: LTMessage,
  senderPubkey: string,
): void {
  const myPubkey = store.getState().identity.pubkey;
  // Ignore our own messages
  if (senderPubkey === myPubkey) return;
  if (DJ_ONLY_TYPES.has(msg.type) && !isAuthorizedDJMessage(msg, senderPubkey)) return;

  _isApplyingRemote = true;
  try {
    switch (msg.type) {
      case "lt:start":
        handleStart(msg.data as unknown as LTStartPayload, msg.ts);
        break;
      case "lt:end":
        handleEnd();
        break;
      case "lt:play":
        handlePlay(msg, senderPubkey);
        break;
      case "lt:pause":
        handlePause(msg);
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
      // Listener messages: the acting pubkey is the sender, whatever the
      // payload claims (no voting or leaving on someone else's behalf).
      case "lt:request_dj":
        handleRequestDJ(senderPubkey);
        break;
      case "lt:vote_skip":
        handleVoteSkip(senderPubkey);
        break;
      case "lt:reaction":
        handleReaction(msg.data as unknown as LTReactionPayload, senderPubkey);
        break;
      case "lt:join":
        handleJoin(senderPubkey);
        break;
      case "lt:leave":
        handleLeave(senderPubkey);
        break;
      case "lt:suggest":
        handleSuggest(msg.data as unknown as LTSuggestPayload, senderPubkey);
        break;
    }
  } finally {
    _isApplyingRemote = false;
  }
}

// ── Internal handlers ─────────────────────────────────────────────

function handleStart(payload: LTStartPayload, msgTs: number): void {
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

  // DJs re-send lt:start whenever someone joins the room. From the DJ whose
  // session we dismissed, that's the same session — refresh it quietly.
  const sameDismissedSession = lt.dismissed && lt.dismissedDJ === payload.djPubkey;
  if (!sameDismissedSession) store.dispatch(setDismissed(false));

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
      ts: anchorTime(msgTs),
    }),
  );
}

function handleEnd(): void {
  store.dispatch(endSession());
}

function handlePlay(msg: LTMessage, senderPubkey: string): void {
  const lt = store.getState().listenTogether;
  const payload = msg.data as unknown as LTPlayPayload;
  const at = anchorTime(msg.ts);

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
          ts: at,
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
            djPubkey: senderPubkey,
            context,
            roomId,
            trackId: payload.trackId,
            trackMeta: payload.trackMeta,
            queue: payload.queue,
            queueIndex: payload.queueIndex,
            position: payload.position,
            isPlaying: true,
            ts: at,
          }),
        );
      }
    }
    return;
  }

  const sameTrack = store.getState().music.player.currentTrackId === payload.trackId;

  if (sameTrack) {
    // Resume, or the DJ re-anchoring once its own audio became playable —
    // a sync, not a reload (reloading would restart a slow listener's load).
    store.dispatch(setIsPlaying(true));
  } else {
    ensureTrackAvailable(payload.trackId, payload.trackMeta);
    store.dispatch(
      setCurrentTrack({
        trackId: payload.trackId,
        queue: payload.queue,
        queueIndex: payload.queueIndex,
      }),
    );
    store.dispatch(clearSkipVotes());
  }

  store.dispatch(
    setSharedQueue({ queue: payload.queue, queueIndex: payload.queueIndex }),
  );
  store.dispatch(
    setLTCurrentTrack({
      trackId: payload.trackId,
      isPlaying: true,
      position: payload.position,
    }),
  );

  seekTrackTo(payload.trackId, payload.position, {
    at,
    tolerance: sameTrack ? STATE_CHANGE_TOLERANCE_S : undefined,
  });
}

function handlePause(msg: LTMessage): void {
  const lt = store.getState().listenTogether;
  const payload = msg.data as unknown as LTPausePayload;

  if (!lt.active) {
    store.dispatch(
      updatePendingInvite({ position: payload.position, isPlaying: false, ts: anchorTime(msg.ts) }),
    );
    return;
  }

  store.dispatch(setIsPlaying(false));
  store.dispatch(setLTIsPlaying(false));
  store.dispatch(setLTPosition(payload.position));
  const trackId = store.getState().music.player.currentTrackId;
  if (trackId) seekTrackTo(trackId, payload.position, { tolerance: STATE_CHANGE_TOLERANCE_S });
}

function handleSeek(msg: LTMessage): void {
  const lt = store.getState().listenTogether;
  const payload = msg.data as unknown as LTSeekPayload;
  const at = anchorTime(msg.ts);

  if (!lt.active) {
    store.dispatch(updatePendingInvite({ position: payload.position, ts: at }));
    return;
  }

  // DJs send lt:seek as a periodic heartbeat too — only act on real drift.
  const trackId = store.getState().music.player.currentTrackId;
  if (trackId) {
    seekTrackTo(trackId, payload.position, { at, tolerance: HEARTBEAT_TOLERANCE_S });
  }
  store.dispatch(setLTPosition(payload.position));
}

function handleQueue(payload: LTQueuePayload): void {
  const lt = store.getState().listenTogether;

  if (!lt.active) {
    store.dispatch(updatePendingInvite({ queue: payload.queue }));
    return;
  }

  // A long queue arrives windowed (LT_MAX_QUEUE) — re-find the current track
  // rather than trusting an index into the old list.
  const currentTrackId = store.getState().music.player.currentTrackId;
  const found = currentTrackId ? payload.queue.indexOf(currentTrackId) : -1;
  const queueIndex = found >= 0 ? found : store.getState().listenTogether.sharedQueueIndex;
  store.dispatch(setQueue(payload.queue));
  store.dispatch(setSharedQueue({ queue: payload.queue, queueIndex }));
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
  if (!store.getState().listenTogether.active) {
    // Not joined: our invite / dismissal follows the session to its new DJ,
    // or we'd join under the old DJ and ignore the new one's controls.
    store.dispatch(retargetPendingSession(payload.targetPubkey));
    return;
  }
  const isLocal = payload.targetPubkey === myPubkey;
  store.dispatch(setDJ({ pubkey: payload.targetPubkey, isLocal }));
  // Announce the takeover with our full state: re-syncs pending invites and
  // anyone who missed the transfer packet.
  if (isLocal) broadcastSessionToLateJoiner();
}

function handleRequestDJ(requesterPubkey: string): void {
  const lt = store.getState().listenTogether;
  // Auto-accept in DM context (either party can toggle DJ freely)
  if (lt.context === "dm" && lt.isLocalDJ) {
    transferDJ(requesterPubkey);
  }
  // In spaces, request is logged but DJ must explicitly accept (future UI)
}

function handleVoteSkip(voterPubkey: string): void {
  store.dispatch(addSkipVote(voterPubkey));
  checkSkipThreshold();
}

function handleReaction(payload: LTReactionPayload, senderPubkey: string): void {
  if (typeof payload?.emoji !== "string") return;
  store.dispatch(
    addReaction({
      pubkey: senderPubkey,
      emoji: payload.emoji,
      ts: Date.now(),
    }),
  );
}

function handleJoin(pubkey: string): void {
  store.dispatch(addListener(pubkey));
}

function handleLeave(pubkey: string): void {
  store.dispatch(removeListener(pubkey));
  store.dispatch(removeSkipVote(pubkey));
}

function handleSuggest(payload: LTSuggestPayload, from: string): void {
  const lt = store.getState().listenTogether;
  // Only the DJ acts on suggestions.
  if (!lt.active || !lt.isLocalDJ) return;
  store.dispatch(
    addSuggestion({ trackId: payload.trackId, trackMeta: payload.trackMeta, from, ts: Date.now() }),
  );
}

// ── Utilities ─────────────────────────────────────────────────────

/**
 * May this track's metadata (title, cover, blob/HLS URLs) be sent to the
 * session's listeners? Public tracks always. A space-scoped track only inside
 * a voice channel of one of its own spaces, where every listener is a member.
 * Private, unlisted, and local tracks never: a DM peer or another space's room
 * is outside their audience, and for a NIP-44 private track the plain blob URL
 * in `variants` is the whole capability (docs/MUSIC_VISIBILITY.md).
 */
export function canShareTrackWithListeners(
  track: Pick<MusicTrack, "visibility" | "spaceIds">,
  context: "space" | "dm" | null,
  roomSpaceId: string | null | undefined,
): boolean {
  if (track.visibility === "public") return true;
  if (track.visibility === "space") {
    return context === "space" && !!roomSpaceId && track.spaceIds.includes(roomSpaceId);
  }
  return false;
}

function shareableTrack(trackId: string | null | undefined): MusicTrack | null {
  if (!trackId) return null;
  const state = store.getState();
  const track = state.music.tracks[trackId];
  if (!track) return null;
  const lt = state.listenTogether;
  const roomSpaceId = lt.context === "space" ? state.voice.connectedRoom?.spaceId : null;
  return canShareTrackWithListeners(track, lt.context, roomSpaceId) ? track : null;
}

/**
 * The shared queue with every track the listeners may not see removed (their
 * addressable ids carry the slug ≈ title). `queueIndex` is re-pointed at the
 * current track, or 0 when it was dropped.
 */
function shareableQueue(queue: string[], queueIndex: number): { queue: string[]; queueIndex: number } {
  const current = queue[queueIndex];
  const kept = queue.filter((id) => shareableTrack(id) !== null);
  const idx = current ? kept.indexOf(current) : -1;
  return { queue: kept, queueIndex: idx >= 0 ? idx : 0 };
}

function buildTrackMeta(track: MusicTrack): TrackMeta {
  return {
    title: track.title,
    artist: track.artist,
    imageUrl: track.imageUrl,
    variants: track.variants,
    // "local" (an unpublished upload) is unplayable for anyone else anyway.
    visibility: track.visibility === "local" ? "private" : track.visibility,
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
  // Normalized by the decoder: one of the three wire values, or absent.
  const visibility = meta.visibility;
  store.dispatch(
    addTrack({
      addressableId: trackId,
      eventId: "",
      pubkey: pubkey ?? "",
      title: meta.title,
      artist: meta.artist,
      artistPubkeys: [],
      featuredArtists: [],
      collaborators: [],
      duration: undefined,
      genre: undefined,
      hashtags: [],
      variants: meta.variants,
      imageUrl: meta.imageUrl,
      createdAt: Math.floor(Date.now() / 1000),
      // Untrusted hint: a wrong one only costs a failed load, never access —
      // the backend gates the blob either way.
      visibility: visibility ?? "public",
      accessUnknown: visibility === undefined,
      spaceIds: [],
      inCatalog: true,
    }),
  );
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
