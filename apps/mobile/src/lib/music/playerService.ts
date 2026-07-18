// Module singleton wrapping react-native-track-player. Owns: idempotent setup,
// the imperative transport the thunks call, and the RNTP Event.* → Redux-mirror
// bridge. RNTP is the queue authority; this bridge only reflects its state into
// musicSlice for the UI. Live position is NOT bridged — MiniPlayer/NowPlaying
// read it via RNTP useProgress().

import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  State,
} from "react-native-track-player";

import type { MusicItem } from "@/screens/spaces/musicEventParser";
import type { AppDispatch } from "@/store";
import {
  mirrorStatusChanged,
  mirrorTrackChanged,
  playbackEnded,
  playerErrored,
  type MusicRepeat,
  type MusicStatus,
} from "@/store/slices/musicSlice";
import { toTrack } from "./audioSource";

let setupPromise: Promise<void> | null = null;
let dispatch: AppDispatch | null = null;
let listenersBound = false;

/** Wire the store dispatch so RNTP events can update the Redux mirror. Called
 *  once at app boot (App.tsx store factory). */
export function attachStore(next: AppDispatch): void {
  dispatch = next;
}

const REPEAT_TO_RNTP: Record<MusicRepeat, RepeatMode> = {
  off: RepeatMode.Off,
  track: RepeatMode.Track,
  queue: RepeatMode.Queue,
};

function mapState(state: State): MusicStatus {
  switch (state) {
    case State.Playing:
      return "playing";
    case State.Paused:
      return "paused";
    case State.Buffering:
    case State.Loading:
    case State.Ready:
      return "loading";
    case State.Error:
      return "error";
    default:
      return "idle";
  }
}

function bindEvents(): void {
  if (listenersBound) return;
  listenersBound = true;

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, (e) => {
    const track = e?.track as { id?: string; duration?: number } | undefined;
    const currentId = typeof track?.id === "string" ? track.id : null;
    const durationSec = typeof track?.duration === "number" ? track.duration : undefined;
    dispatch?.(mirrorTrackChanged({ currentId, durationSec }));
  });

  TrackPlayer.addEventListener(Event.PlaybackState, (e) => {
    const status = mapState(e.state);
    dispatch?.(status === "idle" ? playbackEnded() : mirrorStatusChanged(status));
  });

  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
    dispatch?.(playbackEnded());
  });

  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    dispatch?.(playerErrored(String(e?.message ?? "Playback error")));
  });
}

/** Idempotent player setup — guarded against Fast-Refresh/remount double-init.
 *  On failure the promise is cleared so a later call can retry. */
export function setup(): Promise<void> {
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    await TrackPlayer.setupPlayer();
    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      android: {
        appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
      },
    });
    bindEvents();
  })().catch((err) => {
    setupPromise = null;
    throw err;
  });
  return setupPromise;
}

/** Replace the queue with `items` (all pre-filtered to playable) and start at
 *  `startIndex`. */
export async function loadQueue(items: MusicItem[], startIndex: number): Promise<void> {
  await setup();
  const tracks = await Promise.all(items.map(toTrack));
  await TrackPlayer.reset();
  await TrackPlayer.add(tracks);
  const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
  if (idx > 0) await TrackPlayer.skip(idx);
  await TrackPlayer.play();
}

/** Rebuild the queue to a new order (shuffle on/off) while resuming the current
 *  track at its current position. `items` must include the current track. */
export async function applyQueueOrder(
  items: MusicItem[],
  currentId: string | null,
): Promise<void> {
  await setup();
  const { position } = await TrackPlayer.getProgress();
  const tracks = await Promise.all(items.map(toTrack));
  const currentIdx = Math.max(
    0,
    items.findIndex((it) => it.addressableId === currentId),
  );
  await TrackPlayer.reset();
  await TrackPlayer.add(tracks);
  if (currentIdx > 0) await TrackPlayer.skip(currentIdx);
  if (position > 0) await TrackPlayer.seekTo(position);
  await TrackPlayer.play();
}

export async function play(): Promise<void> {
  await setup();
  await TrackPlayer.play();
}

export async function pause(): Promise<void> {
  await TrackPlayer.pause();
}

export async function next(): Promise<void> {
  await TrackPlayer.skipToNext().catch(() => {});
}

/** Previous, with the standard "restart if >3s in" behavior. */
export async function previous(): Promise<void> {
  const { position } = await TrackPlayer.getProgress();
  if (position > 3) {
    await TrackPlayer.seekTo(0);
    return;
  }
  await TrackPlayer.skipToPrevious().catch(() => {});
}

export async function seekTo(seconds: number): Promise<void> {
  await TrackPlayer.seekTo(seconds);
}

/** Jump to a queue position (Now Playing queue tap). */
export async function skipTo(index: number): Promise<void> {
  await TrackPlayer.skip(index);
  await TrackPlayer.play();
}

export async function setRepeat(mode: MusicRepeat): Promise<void> {
  await setup();
  await TrackPlayer.setRepeatMode(REPEAT_TO_RNTP[mode]);
}

/** Stop + clear the queue (logout / account switch). No-op before setup. */
export async function reset(): Promise<void> {
  if (!setupPromise) return;
  await TrackPlayer.reset().catch(() => {});
}

/** @internal Test-only: clear singleton state between Jest cases. */
export function __resetForTest(): void {
  setupPromise = null;
  listenersBound = false;
  dispatch = null;
}
