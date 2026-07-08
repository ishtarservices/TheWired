// Chat list shaping: day separators + consecutive-author grouping. Pure so
// the row math is testable; ChannelScreen maps the result straight into its
// FlatList. Mirrors the DM conversation's day-separator idiom.

import type { NostrEvent } from "@thewired/shared-types";

export type ChatRow =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      event: NostrEvent;
      /** Same author within the window — render without avatar/name header. */
      grouped: boolean;
    };

/** Messages from the same author within 5 minutes collapse into one run. */
export const GROUP_WINDOW_SEC = 5 * 60;

export function dayLabel(unixSeconds: number, nowMs = Date.now()): string {
  const date = new Date(unixSeconds * 1000);
  const today = new Date(nowMs);
  const yesterday = new Date(nowMs - 86_400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? null : { year: "numeric" }),
  });
}

export function timeLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `events` must already be ascending by created_at (the session's order). */
export function buildChatRows(events: NostrEvent[], nowMs = Date.now()): ChatRow[] {
  const rows: ChatRow[] = [];
  let lastDay: string | null = null;
  let prev: NostrEvent | null = null;

  for (const event of events) {
    const label = dayLabel(event.created_at, nowMs);
    if (label !== lastDay) {
      rows.push({ kind: "day", key: `day-${event.id}`, label });
      lastDay = label;
      prev = null; // never group across a day boundary
    }
    const grouped =
      prev !== null &&
      prev.pubkey === event.pubkey &&
      event.created_at - prev.created_at < GROUP_WINDOW_SEC;
    rows.push({ kind: "message", key: event.id, event, grouped });
    prev = event;
  }
  return rows;
}
