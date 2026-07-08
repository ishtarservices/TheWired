// Music-channel parsing: kind 31683 (track) + 33123 (album) → list rows.
// Display-only this pass (no mobile player yet); tag names mirror the
// desktop trackParser/albumParser (title/artist/image/thumb, album `a` refs).

import type { NostrEvent } from "@thewired/shared-types";

export interface MusicItem {
  id: string;
  event: NostrEvent;
  kind: "track" | "album";
  title: string;
  /** Artist display string (tag, else the author pubkey renders upstream). */
  artist: string | null;
  /** https artwork URL, if any. */
  artwork: string | null;
  /** Track count for albums (from 31683 `a` refs). */
  trackCount?: number;
  /** Duration in seconds for tracks, when tagged. */
  durationSec?: number;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function httpsOrNull(value: string | undefined): string | null {
  return value && /^https:\/\//i.test(value) ? value : null;
}

export function parseMusicEvent(event: NostrEvent): MusicItem | null {
  if (event.kind !== 31683 && event.kind !== 33123) return null;

  const title = tagValue(event, "title")?.trim() || "Untitled";
  const artwork = httpsOrNull(tagValue(event, "image") ?? tagValue(event, "thumb"));
  const artist = tagValue(event, "artist")?.trim() || null;

  if (event.kind === 33123) {
    const trackCount = event.tags.filter(
      (t) => t[0] === "a" && t[1]?.startsWith("31683:"),
    ).length;
    return { id: event.id, event, kind: "album", title, artist, artwork, trackCount };
  }

  const durationRaw = Number.parseFloat(tagValue(event, "duration") ?? "");
  return {
    id: event.id,
    event,
    kind: "track",
    title,
    artist,
    artwork,
    ...(Number.isFinite(durationRaw) && durationRaw > 0
      ? { durationSec: Math.round(durationRaw) }
      : {}),
  };
}

export function parseMusicEvents(events: NostrEvent[]): MusicItem[] {
  const out: MusicItem[] = [];
  for (const event of events) {
    const item = parseMusicEvent(event);
    if (item) out.push(item);
  }
  return out;
}

export function formatTrackDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
