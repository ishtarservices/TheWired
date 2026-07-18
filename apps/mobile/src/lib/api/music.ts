// Music discovery over the backend API through the gateway (services/backend/
// src/routes/music.ts). GET /music/browse is public — the gateway passes
// unauthenticated requests through and the route defensively drops any event
// carrying a `visibility` or `h` tag, so guests browse only public music
// (5.1.1(v)). The endpoint returns FULL Nostr events, so we reuse the same
// parseMusicEvents the space-feed screen uses.

import { API_BASE } from "@/lib/env";
import { parseMusicEvents, type MusicItem } from "@/screens/spaces/musicEventParser";
import type { NostrEvent } from "@thewired/shared-types";

function isEventish(x: unknown): x is NostrEvent {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { kind?: unknown }).kind === "number" &&
    Array.isArray((x as { tags?: unknown }).tags) &&
    typeof (x as { id?: unknown }).id === "string" &&
    typeof (x as { pubkey?: unknown }).pubkey === "string"
  );
}

/** Parse the `{ data: { tracks: NostrEvent[] } }` browse envelope into playable
 *  items. Non-event rows drop; parseMusicEvents drops non-music kinds. */
export function parseBrowseTracks(payload: unknown): MusicItem[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return [];
  const tracks = (data as { tracks?: unknown }).tracks;
  if (!Array.isArray(tracks)) return [];
  return parseMusicEvents(tracks.filter(isEventish));
}

/** Trending public tracks (GET /music/browse?sort=trending). */
export async function fetchTrendingTracks(limit = 30): Promise<MusicItem[]> {
  const params = new URLSearchParams({ sort: "trending", limit: String(limit) });
  const response = await fetch(`${API_BASE}/music/browse?${params}`);
  if (!response.ok) throw new Error(`Music browse unavailable (${response.status})`);
  return parseBrowseTracks(await response.json());
}
