import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { store } from "@/store";
import {
  setCurrentTrack,
  togglePlay,
  setIsPlaying,
  updatePosition,
  setDuration,
  setVolume as setVolumeAction,
  toggleMute as toggleMuteAction,
  toggleShuffle as toggleShuffleAction,
  setRepeat,
  nextTrack,
  prevTrack,
  addToQueue as addToQueueAction,
  removeFromQueue as removeFromQueueAction,
  addRecentlyPlayed,
} from "@/store/slices/musicSlice";
import { selectAudioSource } from "./trackParser";
import { reportPlay } from "@/lib/api/music";
import { getCachedAudio } from "@/lib/db/audioCache";
import type { RepeatMode } from "@/types/music";

// Module-level audio element singleton — persists across navigation
let audio: HTMLAudioElement | null = null;
// Track the currently loaded track ID at module level to prevent restart on remount
let loadedTrackId: string | null = null;
// Track object URLs so we can revoke them to prevent memory leaks
let currentObjectUrl: string | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

// Throttle position updates to ~4Hz
let lastPositionUpdate = 0;

// ── Module-level audio event listeners (registered once, not per-component) ──
// This prevents the bug where multiple components calling useAudioPlayer()
// each register their own onEnded handler, causing nextTrack() to fire N times.
let listenersRegistered = false;

function setupAudioListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const el = getAudio();

  el.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - lastPositionUpdate > 250) {
      lastPositionUpdate = now;
      store.dispatch(updatePosition(el.currentTime));
    }
  });

  el.addEventListener("loadedmetadata", () => {
    store.dispatch(setDuration(el.duration));
  });

  el.addEventListener("ended", () => {
    const p = store.getState().music.player;
    if (p.repeat === "one") {
      el.currentTime = 0;
      el.play();
    } else {
      store.dispatch(nextTrack());
    }
  });

  el.addEventListener("pause", () => {
    store.dispatch(setIsPlaying(false));
  });

  el.addEventListener("play", () => {
    store.dispatch(setIsPlaying(true));
  });
}

export function useAudioPlayer() {
  const dispatch = useAppDispatch();
  const player = useAppSelector((s) => s.music.player);
  const tracks = useAppSelector((s) => s.music.tracks);
  const currentTrack = player.currentTrackId
    ? tracks[player.currentTrackId]
    : null;

  // Register audio listeners once at module level (idempotent)
  setupAudioListeners();

  // Sync volume to audio element
  useEffect(() => {
    const el = getAudio();
    // x^3 curve for logarithmic perception
    el.volume = player.isMuted ? 0 : Math.pow(player.volume, 3);
  }, [player.volume, player.isMuted]);

  // Load and play when current track changes
  useEffect(() => {
    if (!currentTrack) {
      loadedTrackId = null;
      return;
    }

    // Skip if this track is already loaded (prevents restart on component remount)
    if (loadedTrackId === currentTrack.addressableId) return;

    const el = getAudio();
    const remoteUrl = selectAudioSource(currentTrack.variants);
    if (!remoteUrl) return;

    const targetId = currentTrack.addressableId;
    loadedTrackId = targetId;

    const loadAndPlay = async () => {
      // Revoke previous object URL to prevent memory leak
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }

      // Check offline cache first
      const cached = await getCachedAudio(targetId).catch(() => null);

      // Guard: if user switched tracks during the async gap, abort
      if (loadedTrackId !== targetId) return;

      let src: string;
      if (cached) {
        src = URL.createObjectURL(cached.blob);
        currentObjectUrl = src;
      } else {
        src = remoteUrl;
      }

      if (el.src !== src) {
        el.src = src;
      }
      el.currentTime = 0;
      try {
        await el.play();
        // Final guard before reporting play
        if (loadedTrackId === targetId) {
          reportPlay(currentTrack.eventId);
        }
      } catch {
        // Autoplay might be blocked
      }
    };

    loadAndPlay();

    // Update Media Session
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        artwork: currentTrack.imageUrl
          ? [{ src: currentTrack.imageUrl, sizes: "512x512", type: "image/jpeg" }]
          : [],
      });
    }

    dispatch(addRecentlyPlayed(currentTrack.addressableId));
  }, [currentTrack?.addressableId]); // eslint-disable-line react-hooks/exhaustive-deps

  // React to isPlaying state changes from Redux (e.g. nextTrack reducer)
  useEffect(() => {
    const el = getAudio();
    if (!el.src) return;
    if (player.isPlaying && el.paused) {
      el.play().catch(() => {});
    } else if (!player.isPlaying && !el.paused) {
      el.pause();
    }
  }, [player.isPlaying]);

  // When queue index changes (from nextTrack/prevTrack reducers), load new track
  useEffect(() => {
    const trackId = player.queue[player.queueIndex];
    if (trackId && trackId !== player.currentTrackId) {
      dispatch(setCurrentTrack({ trackId, queueIndex: player.queueIndex }));
    }
  }, [player.queueIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Media Session handlers
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => dispatch(setIsPlaying(true)));
    navigator.mediaSession.setActionHandler("pause", () => dispatch(setIsPlaying(false)));
    navigator.mediaSession.setActionHandler("previoustrack", () => dispatch(prevTrack()));
    navigator.mediaSession.setActionHandler("nexttrack", () => dispatch(nextTrack()));
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) {
        getAudio().currentTime = details.seekTime;
        dispatch(updatePosition(details.seekTime));
      }
    });
  }, [dispatch]);

  const play = useCallback(
    (trackId: string) => {
      dispatch(setCurrentTrack({ trackId, queue: [trackId], queueIndex: 0 }));
    },
    [dispatch],
  );

  const pause = useCallback(() => {
    dispatch(setIsPlaying(false));
  }, [dispatch]);

  const resume = useCallback(() => {
    dispatch(setIsPlaying(true));
  }, [dispatch]);

  const next = useCallback(() => {
    dispatch(nextTrack());
  }, [dispatch]);

  const prev = useCallback(() => {
    dispatch(prevTrack());
  }, [dispatch]);

  const seek = useCallback(
    (seconds: number) => {
      getAudio().currentTime = seconds;
      dispatch(updatePosition(seconds));
    },
    [dispatch],
  );

  const setVol = useCallback(
    (v: number) => {
      dispatch(setVolumeAction(v));
    },
    [dispatch],
  );

  const toggleMuteHandler = useCallback(() => {
    dispatch(toggleMuteAction());
  }, [dispatch]);

  const toggleShuffleHandler = useCallback(() => {
    dispatch(toggleShuffleAction());
  }, [dispatch]);

  const cycleRepeat = useCallback(() => {
    const order: RepeatMode[] = ["none", "all", "one"];
    const nextMode = order[(order.indexOf(player.repeat) + 1) % order.length];
    dispatch(setRepeat(nextMode));
  }, [dispatch, player.repeat]);

  const playQueue = useCallback(
    (trackIds: string[], startIndex = 0) => {
      if (trackIds.length === 0) return;
      dispatch(
        setCurrentTrack({
          trackId: trackIds[startIndex],
          queue: trackIds,
          queueIndex: startIndex,
        }),
      );
    },
    [dispatch],
  );

  const addToQueue = useCallback(
    (trackId: string) => {
      dispatch(addToQueueAction(trackId));
    },
    [dispatch],
  );

  const removeFromQueueHandler = useCallback(
    (index: number) => {
      dispatch(removeFromQueueAction(index));
    },
    [dispatch],
  );

  const togglePlayHandler = useCallback(() => {
    dispatch(togglePlay());
  }, [dispatch]);

  return {
    currentTrack,
    player,
    play,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume: setVol,
    toggleMute: toggleMuteHandler,
    toggleShuffle: toggleShuffleHandler,
    cycleRepeat,
    playQueue,
    addToQueue,
    removeFromQueue: removeFromQueueHandler,
    togglePlay: togglePlayHandler,
  };
}
