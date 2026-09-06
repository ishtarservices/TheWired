/**
 * Persisted media preferences — device choices, audio processing flags, and
 * per-participant volume/mute — for voice channels and 1:1 calls.
 *
 * Why this exists: there was no device selection at all. The WebView always
 * captured from the OS "Default" endpoint, which on Windows is frequently
 * NOT the headset (Windows keeps separate "Default" and "Communications"
 * devices), producing echo, the wrong mic, and audio on the wrong speaker.
 *
 * Plain module store + `localStorage` (device ids are per-machine, so they
 * deliberately do not sync through Nostr/IDB user state). React reads it via
 * `useSyncExternalStore` in features/voice/devices/useMediaPrefs.ts.
 */

const PREFS_KEY = "thewired.media.prefs";
const PARTICIPANTS_KEY = "thewired.media.participants";

export interface MediaPrefs {
  /** Preferred deviceIds; null = system default. */
  audioInput: string | null;
  videoInput: string | null;
  audioOutput: string | null;
  /** WebRTC capture processing. All on by default (Chromium/WebKit defaults). */
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** Screen share tuned for video/motion (1080p30, 5 Mbps) instead of text (1080p15). */
  screenShareMotion: boolean;
}

export const DEFAULT_MEDIA_PREFS: MediaPrefs = {
  audioInput: null,
  videoInput: null,
  audioOutput: null,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  screenShareMotion: false,
};

export interface ParticipantAudioPrefs {
  /** Playback volume 0..1 (1 = unchanged). */
  volume: number;
  /** Locally muted — only this client stops hearing them. */
  muted: boolean;
}

export const DEFAULT_PARTICIPANT_AUDIO: ParticipantAudioPrefs = Object.freeze({
  volume: 1,
  muted: false,
});

type PrefsListener = (next: MediaPrefs, prev: MediaPrefs) => void;
type ParticipantListener = (pubkey: string, prefs: ParticipantAudioPrefs) => void;

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode / quota) — prefs live in memory only.
  }
}

let prefs: MediaPrefs = { ...DEFAULT_MEDIA_PREFS, ...(readJSON<Partial<MediaPrefs>>(PREFS_KEY) ?? {}) };
let participants: Record<string, ParticipantAudioPrefs> =
  readJSON<Record<string, ParticipantAudioPrefs>>(PARTICIPANTS_KEY) ?? {};

const prefsListeners = new Set<PrefsListener>();
const participantListeners = new Set<ParticipantListener>();

export function getMediaPrefs(): MediaPrefs {
  return prefs;
}

/** Merge a patch, persist, and notify — no-op if nothing changed. */
export function setMediaPrefs(patch: Partial<MediaPrefs>): MediaPrefs {
  const next = { ...prefs, ...patch };
  const changed = (Object.keys(next) as (keyof MediaPrefs)[]).some((k) => next[k] !== prefs[k]);
  if (!changed) return prefs;
  const prev = prefs;
  prefs = next;
  writeJSON(PREFS_KEY, prefs);
  for (const fn of prefsListeners) fn(prefs, prev);
  return prefs;
}

export function subscribeMediaPrefs(fn: PrefsListener): () => void {
  prefsListeners.add(fn);
  return () => {
    prefsListeners.delete(fn);
  };
}

/** Which audio processing flags differ between two pref snapshots. */
export function audioProcessingChanged(a: MediaPrefs, b: MediaPrefs): boolean {
  return (
    a.echoCancellation !== b.echoCancellation ||
    a.noiseSuppression !== b.noiseSuppression ||
    a.autoGainControl !== b.autoGainControl
  );
}

export function getParticipantAudio(pubkey: string): ParticipantAudioPrefs {
  return participants[pubkey] ?? DEFAULT_PARTICIPANT_AUDIO;
}

export function setParticipantAudio(
  pubkey: string,
  patch: Partial<ParticipantAudioPrefs>,
): ParticipantAudioPrefs {
  const current = getParticipantAudio(pubkey);
  const next: ParticipantAudioPrefs = {
    volume: clamp01(patch.volume ?? current.volume),
    muted: patch.muted ?? current.muted,
  };
  if (next.volume === current.volume && next.muted === current.muted) return current;
  if (next.volume === 1 && !next.muted) {
    // Back to defaults — drop the row so storage doesn't accumulate.
    delete participants[pubkey];
  } else {
    participants = { ...participants, [pubkey]: next };
  }
  writeJSON(PARTICIPANTS_KEY, participants);
  const stored = getParticipantAudio(pubkey);
  for (const fn of participantListeners) fn(pubkey, stored);
  return stored;
}

export function subscribeParticipantAudio(fn: ParticipantListener): () => void {
  participantListeners.add(fn);
  return () => {
    participantListeners.delete(fn);
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}

/** Test hook — reset in-memory state and storage. */
export function __resetMediaPrefsForTests(): void {
  prefs = { ...DEFAULT_MEDIA_PREFS };
  participants = {};
  try {
    localStorage.removeItem(PREFS_KEY);
    localStorage.removeItem(PARTICIPANTS_KEY);
  } catch {
    /* ignore */
  }
}

/** Test hook — re-read from storage (simulates a fresh app launch). */
export function __reloadMediaPrefsForTests(): void {
  prefs = { ...DEFAULT_MEDIA_PREFS, ...(readJSON<Partial<MediaPrefs>>(PREFS_KEY) ?? {}) };
  participants = readJSON<Record<string, ParticipantAudioPrefs>>(PARTICIPANTS_KEY) ?? {};
}
