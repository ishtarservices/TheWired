import { useState, useEffect } from "react";

/**
 * Format a unix-seconds timestamp as a short relative string.
 * Compact output: "now", "1m", "5m", "2h", "3d"
 */
function formatRelative(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Format a unix-seconds timestamp as a verbose relative string.
 * Verbose output: "just now", "3 minutes ago", "2 hours ago", "1 day ago"
 */
function formatRelativeVerbose(unixSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Shared tick: all hook instances re-render off the same setInterval.
// Avoids N independent timers for N message bubbles.
let tickListeners = new Set<() => void>();
let tickInterval: ReturnType<typeof setInterval> | null = null;

function subscribeTick(cb: () => void) {
  tickListeners.add(cb);
  if (tickListeners.size === 1) {
    tickInterval = setInterval(() => {
      for (const fn of tickListeners) fn();
    }, 60_000);
  }
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  };
}

/**
 * Returns a live-updating relative time string for a unix-seconds timestamp.
 * Re-renders every 60 seconds (shared interval across all instances).
 *
 * @param unixSeconds - Unix timestamp in seconds
 * @param verbose - If true, use "3 minutes ago" style. Default: compact "3m" style.
 */
export function useRelativeTime(unixSeconds: number, verbose = false): string {
  const fmt = verbose ? formatRelativeVerbose : formatRelative;
  const [text, setText] = useState(() => fmt(unixSeconds));

  useEffect(() => {
    // Update immediately when timestamp changes
    setText(fmt(unixSeconds));

    const unsub = subscribeTick(() => {
      setText(fmt(unixSeconds));
    });
    return unsub;
  }, [unixSeconds, verbose]);

  return text;
}
