import type { Middleware } from "@reduxjs/toolkit";
import { isApplyingRemote } from "./listenTogetherService";
import {
  broadcastPlay,
  broadcastPause,
  broadcastResume,
  broadcastSeek,
  broadcastNext,
  broadcastPrev,
  broadcastQueue,
} from "./listenTogetherService";

/**
 * Redux middleware that watches musicSlice actions and broadcasts them
 * as Listen Together messages when the local user is the DJ.
 *
 * Ignores actions dispatched by the incoming message handler (isApplyingRemote guard).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const listenTogetherMiddleware: Middleware<object, any> =
  (storeApi) => (next) => (action) => {
    const prevPlayer = storeApi.getState().music.player;
    // Let the action through first
    const result = next(action);

    // Skip if not an active LT session or not the DJ
    const state = storeApi.getState();
    if (!state.listenTogether?.active || !state.listenTogether?.isLocalDJ) {
      return result;
    }

    // Skip actions dispatched by the incoming message handler
    if (isApplyingRemote()) {
      return result;
    }

    const type = (action as { type: string }).type;

    switch (type) {
      case "music/setCurrentTrack": {
        // A new track was started — broadcast play
        const p = state.music.player;
        if (p.currentTrackId) {
          broadcastPlay(p.currentTrackId, p.position, p.queue, p.queueIndex);
        }
        break;
      }

      case "music/togglePlay":
      case "music/setIsPlaying": {
        const p = state.music.player;
        if (p.isPlaying) {
          // Play after the queue ran out restarts the last track (the element
          // rewinds an ended track itself) — don't send listeners to its end.
          const ended = p.duration > 0 && p.position >= p.duration - 0.5;
          broadcastResume(ended ? 0 : p.position);
        } else {
          broadcastPause(p.position);
        }
        break;
      }

      case "music/nextTrack": {
        const p = storeApi.getState().music.player;
        const advanced =
          p.queueIndex !== prevPlayer.queueIndex || p.currentTrackId !== prevPlayer.currentTrackId;
        if (!advanced && prevPlayer.repeat !== "all") {
          // End of the queue: everyone stops at the end of the last track
          // (matches mobile DJs) instead of replaying it from 0.
          broadcastPause(p.duration || p.position);
          break;
        }
        broadcastNext();
        if (p.currentTrackId) {
          broadcastPlay(p.currentTrackId, 0, p.queue, p.queueIndex);
        }
        break;
      }

      case "music/prevTrack": {
        broadcastPrev();
        const updated = storeApi.getState();
        const p = updated.music.player;
        if (p.currentTrackId) {
          broadcastPlay(p.currentTrackId, 0, p.queue, p.queueIndex);
        }
        break;
      }

      case "music/updatePosition": {
        // Only broadcast seeks, not regular timeupdate ticks
        // We detect seeks as large jumps (>2s difference from expected)
        const payload = (action as { payload: number }).payload;
        const expected = state.listenTogether.position;
        if (Math.abs(payload - expected) > 2) {
          broadcastSeek(payload);
        }
        break;
      }

      case "music/reorderQueue":
      case "music/addToQueue":
      case "music/removeFromQueue":
      case "music/setQueue": {
        const updated = storeApi.getState();
        broadcastQueue(updated.music.player.queue);
        break;
      }
    }

    return result;
  };
