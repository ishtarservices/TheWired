/**
 * Session-persisted playback speed.
 * Speed choice is shared across all video players and persists until the app/tab is closed.
 */

const STORAGE_KEY = "wired:playback-speed";
const VALID_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_SPEED = 1;

/** Module-level cache so all components share the same value without re-reading storage */
let cachedSpeed: number = readFromStorage();

function readFromStorage(): number {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (VALID_SPEEDS.includes(parsed as (typeof VALID_SPEEDS)[number])) {
        return parsed;
      }
    }
  } catch {
    // sessionStorage unavailable (SSR, sandboxed iframe, etc.)
  }
  return DEFAULT_SPEED;
}

function writeToStorage(speed: number) {
  cachedSpeed = speed;
  try {
    sessionStorage.setItem(STORAGE_KEY, String(speed));
  } catch {
    // ignore
  }
}

/** Listeners for cross-component reactivity */
type Listener = (speed: number) => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(speed: number) {
  for (const fn of listeners) fn(speed);
}

export function getPlaybackSpeed(): number {
  return cachedSpeed;
}

export function setPlaybackSpeed(speed: number) {
  if (speed === cachedSpeed) return;
  writeToStorage(speed);
  notify(speed);
}

export { VALID_SPEEDS };

// ── React hook ────────────────────────────────────────────────

import { useState, useEffect, useCallback } from "react";

export function usePlaybackSpeed() {
  const [speed, setSpeed] = useState(cachedSpeed);

  useEffect(() => {
    // Sync if another component changed it
    if (cachedSpeed !== speed) setSpeed(cachedSpeed);
    return subscribe((newSpeed) => setSpeed(newSpeed));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSpeed = useCallback((newSpeed: number) => {
    setPlaybackSpeed(newSpeed);
    setSpeed(newSpeed);
  }, []);

  return [speed, updateSpeed] as const;
}
