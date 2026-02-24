import { useCallback, useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
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
import type { RepeatMode } from "@/types/music";

// Module-level audio element singleton — persists across navigation
let audio: HTMLAudioElement | null = null;
// Track the currently loaded track ID at module level to prevent restart on remount
let loadedTrackId: string | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
  }
  return audio;
}

// Throttle position updates to ~4Hz
let lastPositionUpdate = 0;

export function useAudioPlayer() {
  const dispatch = useAppDispatch();
  const player = useAppSelector((s) => s.music.player);
  const tracks = useAppSelector((s) => s.music.tracks);
  const currentTrack = player.currentTrackId
    ? tracks[player.currentTrackId]
    : null;

  const playerRef = useRef(player);
  playerRef.current = player;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  // Set up audio event listeners once
  useEffect(() => {
    const el = getAudio();

    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastPositionUpdate > 250) {
        lastPositionUpdate = now;
        dispatch(updatePosition(el.currentTime));
      }
    };

    const onLoadedMetadata = () => {
      dispatch(setDuration(el.duration));
    };

    const onEnded = () => {
      const p = playerRef.current;
      if (p.repeat === "one") {
        el.currentTime = 0;
        el.play();
      } else {
        dispatch(nextTrack());
      }
    };

    const onPause = () => {
      dispatch(setIsPlaying(false));
    };

    const onPlay = () => {
      dispatch(setIsPlaying(true));
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("ended", onEnded);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
    };
  }, [dispatch]);

  // Sync volume to audio element
  useEffect(() => {
    const el = getAudio();
    // x^3 curve for logarithmic perception
    el.volume = player.isMuted ? 0 : Math.pow(player.volume, 3);
  }, [player.volume, player.isMuted]);

  // Load and play when current track changes
  useEffect(() => {
    if (!currentTrack) return;

    // Skip if this track is already loaded (prevents restart on component remount)
    if (loadedTrackId === currentTrack.addressableId) return;

    const el = getAudio();
    const url = selectAudioSource(currentTrack.variants);
    if (!url) return;

    loadedTrackId = currentTrack.addressableId;

    if (el.src !== url) {
      el.src = url;
    }
    el.currentTime = 0;
    el.play().catch(() => {
      // Autoplay might be blocked
    });

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
