import { useCallback, useEffect } from "react";
import type HlsType from "hls.js";
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
import { reportPlay, getAudioVariants } from "@/lib/api/music";
import { getCachedAudio } from "@/lib/db/audioCache";
import type { RepeatMode } from "@/types/music";

// Module-level audio element singleton — persists across navigation
let audio: HTMLAudioElement | null = null;
// Track the currently loaded track ID at module level to prevent restart on remount
let loadedTrackId: string | null = null;
// Track object URLs so we can revoke them to prevent memory leaks
let currentObjectUrl: string | null = null;

// HLS state — the constructor is loaded lazily the first time we actually
// need MSE playback, so Safari / Tauri macOS never pays the hls.js download cost.
type HlsInstance = InstanceType<typeof HlsType>;
let hlsInstance: HlsInstance | null = null;
let HlsCtor: typeof HlsType | null = null;

// Feature flag — set VITE_PREFER_HLS=false to force playback to use the
// original imeta URL (bypasses the /music/variants/:sha lookup entirely).
const PREFER_HLS = import.meta.env.VITE_PREFER_HLS !== "false";

async function getHlsCtor(): Promise<typeof HlsType> {
  if (!HlsCtor) {
    const mod = await import("hls.js");
    HlsCtor = mod.default;
  }
  return HlsCtor;
}

function teardownHls() {
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch { /* noop */ }
    hlsInstance = null;
  }
}

// ── Next-track prefetch ──────────────────────────────────────────────────────
// When the current track reaches `canplaythrough`, warm the HTTP cache for the
// next queued track: its HLS manifest + init + first segment, or the first
// ~128 KB of the progressive URL. Closes the silent gap between tracks without
// spinning up a second <audio> element.
let prefetchAbort: AbortController | null = null;
let prefetchedNextId: string | null = null;

function cancelPrefetch() {
  if (prefetchAbort) {
    prefetchAbort.abort();
    prefetchAbort = null;
  }
  prefetchedNextId = null;
}

function resolveNextTrackId(state: ReturnType<typeof store.getState>): string | null {
  const p = state.music.player;
  // repeat=one: same element replays, browser buffer is already warm.
  if (p.repeat === "one") return null;
  if (p.queue.length === 0) return null;
  let nextIdx = p.queueIndex + 1;
  if (nextIdx >= p.queue.length) {
    if (p.repeat === "all" && p.queue.length > 1) nextIdx = 0;
    else return null;
  }
  return p.queue[nextIdx] ?? null;
}

async function prefetchNextTrack() {
  const state = store.getState();
  const nextId = resolveNextTrackId(state);
  if (!nextId || nextId === prefetchedNextId) return;
  const nextTrack = state.music.tracks[nextId];
  if (!nextTrack) return;

  cancelPrefetch();
  prefetchedNextId = nextId;
  const ctrl = new AbortController();
  prefetchAbort = ctrl;
  const { signal } = ctrl;
  // `priority` is a recent fetch option — unsupported browsers silently ignore it.
  const lowPri = { signal, priority: "low" } as RequestInit;

  const primaryHash = nextTrack.variants[0]?.hash ?? null;
  const remoteUrl = selectAudioSource(nextTrack.variants);

  try {
    if (PREFER_HLS && primaryHash) {
      const variants = await getAudioVariants(primaryHash);
      if (signal.aborted) return;
      if (variants?.status === "ready" && variants.hlsMaster) {
        const masterAbs = new URL(variants.hlsMaster, location.href);
        const masterRes = await fetch(masterAbs, lowPri);
        if (!masterRes.ok || signal.aborted) return;
        const masterText = await masterRes.text();
        if (signal.aborted) return;
        const firstVariantRel = masterText
          .split("\n")
          .find((l) => l && !l.startsWith("#"));
        if (!firstVariantRel) return;
        const mediaAbs = new URL(firstVariantRel, masterAbs);
        const mediaRes = await fetch(mediaAbs, lowPri);
        if (!mediaRes.ok || signal.aborted) return;
        const mediaText = await mediaRes.text();
        if (signal.aborted) return;
        const initMatch = mediaText.match(/#EXT-X-MAP:URI="([^"]+)"/);
        const firstSegRel = mediaText
          .split("\n")
          .find((l) => l && !l.startsWith("#"));
        const warm = (rel: string) =>
          fetch(new URL(rel, mediaAbs), lowPri).catch(() => {});
        if (initMatch?.[1]) await warm(initMatch[1]);
        if (firstSegRel) await warm(firstSegRel);
        return;
      }
    }
    if (remoteUrl) {
      // Progressive fallback — Range request for the first 128 KB. Enough to
      // decode headers + start playback immediately on track advance.
      await fetch(remoteUrl, {
        ...lowPri,
        headers: { Range: "bytes=0-131071" },
      }).catch(() => {});
    }
  } catch {
    // AbortError or network — silent by design.
  } finally {
    if (prefetchAbort === ctrl) prefetchAbort = null;
  }
}

/** Expose the singleton audio element for direct access (e.g. waveform visualization) */
export function getAudio(): HTMLAudioElement {
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

  el.addEventListener("canplaythrough", () => {
    // Fires once the browser has buffered enough to play through. Use this as
    // the trigger to prefetch the *next* track so its first segment is warm
    // in the HTTP cache by the time the current track ends.
    prefetchNextTrack();
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
      // Tear down any HLS instance from the previous track so buffers/workers
      // don't linger in the background competing for bandwidth.
      teardownHls();
      // Abort any in-flight prefetch — if the user skipped past the prefetched
      // track, the fetch is now dead weight; if they advanced into it, the
      // real load is about to start and will hit the warm HTTP cache.
      cancelPrefetch();

      // Run offline cache and variants lookup in parallel. Variants are
      // keyed by the raw blob sha256 from the event's imeta `x` tag; if a
      // track has no hash we skip the lookup entirely.
      const primaryHash = currentTrack.variants[0]?.hash ?? null;
      const [cached, variants] = await Promise.all([
        getCachedAudio(targetId).catch(() => null),
        PREFER_HLS && primaryHash ? getAudioVariants(primaryHash) : Promise.resolve(null),
      ]);

      // Guard: if user switched tracks during the async gap, abort
      if (loadedTrackId !== targetId) return;

      const playFromOriginal = () => {
        if (el.src !== remoteUrl) el.src = remoteUrl;
      };

      if (cached) {
        // Offline cache hit — instant playback from IndexedDB blob.
        const src = URL.createObjectURL(cached.blob);
        currentObjectUrl = src;
        el.src = src;
      } else if (variants?.status === "ready" && variants.hlsMaster) {
        const hlsUrl = variants.hlsMaster;
        const canNative = el.canPlayType("application/vnd.apple.mpegurl") !== "";
        if (canNative) {
          // Native HLS (Safari, Tauri macOS) — cheaper than hls.js.
          if (el.src !== hlsUrl) el.src = hlsUrl;
        } else {
          try {
            const Hls = await getHlsCtor();
            if (loadedTrackId !== targetId) return;
            if (Hls.isSupported()) {
              const instance = new Hls({ lowLatencyMode: false });
              instance.attachMedia(el);
              instance.loadSource(hlsUrl);
              hlsInstance = instance;
              instance.on(Hls.Events.ERROR, (_evt, data) => {
                // On fatal errors, silently degrade to the original URL so
                // the listener never hears a stall. Ignore errors from a
                // teardown that happened because the user skipped tracks.
                if (data.fatal && loadedTrackId === targetId) {
                  console.warn("[hls] fatal error, falling back:", data.type, data.details);
                  teardownHls();
                  playFromOriginal();
                  el.play().catch(() => {});
                }
              });
            } else {
              playFromOriginal();
            }
          } catch (err) {
            console.warn("[hls] module load failed, falling back:", err);
            playFromOriginal();
          }
        }
      } else {
        // No cache, no ready HLS — original imeta URL.
        playFromOriginal();
      }

      el.currentTime = 0;
      try {
        await el.play();
        // Final guard before reporting play
        if (loadedTrackId === targetId) {
          reportPlay(currentTrack.addressableId);
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
    const el = getAudio();
    // If past 3 seconds, restart current track by seeking the audio element directly
    if (el.currentTime > 2) {
      el.currentTime = 0;
      dispatch(updatePosition(0));
    } else {
      dispatch(prevTrack());
    }
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
