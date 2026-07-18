// Music playback thunks — the command layer between the UI and RNTP. Each thunk
// updates the Redux mirror optimistically and drives playerService; RNTP's
// Event.* bridge (playerService) then confirms the authoritative state. Queue
// order lives in RNTP; these thunks compute shuffle order via the pure
// shuffleOrder helper and rebuild RNTP's queue to match.

import { isPlayable, type MusicItem } from "@/screens/spaces/musicEventParser";
import * as playerService from "@/lib/music/playerService";
import type { AppThunk } from "@/store";
import {
  itemsUpserted,
  queueLoaded,
  repeatSet,
  shuffleApplied,
  playerErrored,
  shuffleOrder,
  type MusicRepeat,
} from "./slices/musicSlice";

/** Play a list of items as the queue, starting at `startIndex` (an index into
 *  the ORIGINAL list). Unplayable items (albums / private / no audio) are
 *  filtered out and the start index is remapped onto the playable subset. */
export function playQueue(items: MusicItem[], startIndex: number): AppThunk<Promise<void>> {
  return async (dispatch) => {
    const playable = items.filter(isPlayable);
    if (playable.length === 0) {
      dispatch(playerErrored("Nothing playable here"));
      return;
    }
    const startItem = items[startIndex];
    const mapped = playable.findIndex(
      (it) => it.addressableId === startItem?.addressableId,
    );
    const idx = mapped >= 0 ? mapped : 0;

    dispatch(itemsUpserted(playable));
    dispatch(
      queueLoaded({
        queueIds: playable.map((it) => it.addressableId),
        currentId: playable[idx].addressableId,
      }),
    );
    try {
      await playerService.loadQueue(playable, idx);
    } catch (err) {
      dispatch(playerErrored(err instanceof Error ? err.message : "Couldn't play track"));
    }
  };
}

export function togglePlay(): AppThunk<Promise<void>> {
  return async (_dispatch, getState) => {
    const status = getState().music.player.status;
    if (status === "playing") await playerService.pause();
    else await playerService.play();
  };
}

export function next(): AppThunk<Promise<void>> {
  return async () => {
    await playerService.next();
  };
}

export function previous(): AppThunk<Promise<void>> {
  return async () => {
    await playerService.previous();
  };
}

export function seekTo(seconds: number): AppThunk<Promise<void>> {
  return async () => {
    await playerService.seekTo(seconds);
  };
}

/** Jump to a track by addressableId within the current queue (Now Playing tap). */
export function jumpTo(addressableId: string): AppThunk<Promise<void>> {
  return async (_dispatch, getState) => {
    const index = getState().music.player.queueIds.indexOf(addressableId);
    if (index < 0) return;
    await playerService.skipTo(index);
  };
}

export function setRepeat(mode: MusicRepeat): AppThunk<Promise<void>> {
  return async (dispatch) => {
    dispatch(repeatSet(mode));
    await playerService.setRepeat(mode);
  };
}

/** Cycle repeat off → queue → track → off (transport UI convenience). */
export function cycleRepeat(): AppThunk<Promise<void>> {
  return async (dispatch, getState) => {
    const current = getState().music.player.repeat;
    const nextMode: MusicRepeat =
      current === "off" ? "queue" : current === "queue" ? "track" : "off";
    await dispatch(setRepeat(nextMode));
  };
}

export function toggleShuffle(): AppThunk<Promise<void>> {
  return async (dispatch, getState) => {
    const { player, itemsById } = getState().music;
    if (player.originalOrder.length === 0) return;
    const nextShuffle = !player.shuffle;
    const order = nextShuffle
      ? shuffleOrder(player.originalOrder, player.currentId)
      : [...player.originalOrder];
    dispatch(shuffleApplied({ queueIds: order, shuffle: nextShuffle }));
    const items = order.map((id) => itemsById[id]).filter((it): it is MusicItem => !!it);
    try {
      await playerService.applyQueueOrder(items, player.currentId);
    } catch (err) {
      dispatch(playerErrored(err instanceof Error ? err.message : "Couldn't reorder queue"));
    }
  };
}
