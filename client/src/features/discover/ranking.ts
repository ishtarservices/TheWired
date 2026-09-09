// Discover ranking + the labels that justify it. Ported from the mobile
// explore tab (soot src/screens/explore/ranking.ts).
//
// Two rules drive everything here:
//   1. Ranking must show its work. Every ranked row carries a mono "why" line,
//      so ordering is never an unexplained authority.
//   2. Never claim a signal we don't have. Trending rides Redis sorted sets the
//      backend warms over time; they are routinely empty. When we fall back to
//      recency we SAY we fell back — labelling recency as "trending" is the one
//      dishonest thing this module must never do.
//
// Pure and time-injectable (`nowMs`) so ordering and labels are testable
// without freezing the clock.

import type { DiscoverSpace } from "@/lib/api/discover";

const DAY_MS = 86_400_000;
const DAY_S = 86_400;

// ─── Spaces ────────────────────────────────────────────────────────────

/** How the directory is ordered. `zapped` is only honest because the backend's
 *  zap rollup landed — discoveryScore carries a real zap term, so ordering by
 *  it is ordering by what the room actually funded. */
export type SpaceRankMode = "zapped" | "active" | "new" | "big";

/** The `sort` the backend understands for each mode. The backend does the real
 *  ordering; rankSpaces only stabilises it client-side. */
export const SPACE_SORT_FOR_MODE: Record<SpaceRankMode, "trending" | "newest" | "popular"> = {
  zapped: "trending",
  active: "trending",
  new: "newest",
  big: "popular",
};

function activityScore(space: DiscoverSpace): number {
  // Mirrors the backend's own weighting (active members count for more than
  // raw message volume) so client and server orderings don't visibly disagree.
  return space.activeMembers24h * 5 + space.messagesLast24h;
}

/** Stable client-side ordering. Ties break on member count then id, so a
 *  re-fetch never reshuffles rows under the reader. */
export function rankSpaces(spaces: DiscoverSpace[], mode: SpaceRankMode): DiscoverSpace[] {
  const scored = [...spaces];
  scored.sort((a, b) => {
    let delta = 0;
    if (mode === "zapped") {
      delta = b.zapSats24h - a.zapSats24h;
      if (delta === 0) delta = b.zapCount24h - a.zapCount24h;
      if (delta === 0) delta = b.discoveryScore - a.discoveryScore;
    } else if (mode === "active") {
      delta = activityScore(b) - activityScore(a);
      if (delta === 0) delta = b.discoveryScore - a.discoveryScore;
    } else if (mode === "new") {
      delta = (b.listedAt ?? b.createdAt ?? 0) - (a.listedAt ?? a.createdAt ?? 0);
    } else {
      delta = b.memberCount - a.memberCount;
    }
    if (delta !== 0) return delta;
    if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return scored;
}

/** The why-line under a space row: what earned this row its position. Returns
 *  null when nothing did — an empty line beats an invented one, and the row
 *  already shows member count and category on its own, so repeating those here
 *  would be noise dressed up as a reason. */
export function spaceSignalLabel(space: DiscoverSpace, nowMs = Date.now()): string | null {
  // Money first when there is any: it is the least gameable signal we have.
  if (space.zapCount24h > 0) {
    const zaps = `${space.zapCount24h} ${space.zapCount24h === 1 ? "zap" : "zaps"}`;
    return space.zapSats24h > 0
      ? `${zaps} · ${formatSats(space.zapSats24h)} today`
      : `${zaps} today`;
  }
  if (space.activeMembers24h > 0) {
    return `${space.activeMembers24h} active today`;
  }
  if (space.messagesLast24h > 0) {
    return `${space.messagesLast24h} ${space.messagesLast24h === 1 ? "post" : "posts"} today`;
  }
  const listed = space.listedAt ?? space.createdAt;
  if (listed !== null && nowMs - listed < 7 * DAY_MS) {
    return "new this week";
  }
  return null;
}

/** Compact sats: 12387 → "12.4k sats". One decimal until the number is big
 *  enough that the decimal stops carrying information (100k+). */
export function formatSats(sats: number): string {
  if (sats < 1000) return `${sats} sats`;
  const unit = sats < 1_000_000 ? { div: 1000, suffix: "k" } : { div: 1_000_000, suffix: "M" };
  const value = sats / unit.div;
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${unit.suffix} sats`;
}

// ─── Music ─────────────────────────────────────────────────────────────

/** Zap aggregate for one addressable coordinate. The desktop has no
 *  coordinate-keyed zap store yet (zapsSlice is event-id keyed), so callers
 *  pass an empty map and ranking degrades to honest recency. */
export interface ZapAggregate {
  msat: number;
  count: number;
}

/** Zap aggregates keyed by addressable coordinate (`kind:pubkey:d`). An empty
 *  map is the normal cold state, not an error. */
export type ZapsByCoordinate = Record<string, ZapAggregate | undefined>;

/** The minimum a track needs to be ranked. `MusicTrack` satisfies it directly
 *  (`createdAt` is unix seconds). */
export interface RankableTrack {
  addressableId: string;
  createdAt: number;
}

export function zapCountFor(item: RankableTrack, zaps: ZapsByCoordinate): number {
  return zaps[item.addressableId]?.count ?? 0;
}

/** Recency baseline with a zap lift. Zaps are log-damped so one whale can't
 *  pin a track to the top forever, and the recency half decays over a week —
 *  new work has to be able to surface. */
export function rankTracks<T extends RankableTrack>(
  items: T[],
  zaps: ZapsByCoordinate,
  nowMs = Date.now(),
): T[] {
  const nowS = Math.floor(nowMs / 1000);
  const score = (item: T): number => {
    const ageDays = Math.max(0, (nowS - item.createdAt) / DAY_S);
    const recency = 1 / (1 + ageDays / 7);
    const count = zapCountFor(item, zaps);
    const zapLift = count > 0 ? Math.log2(1 + count) : 0;
    return recency * 2 + zapLift;
  };
  const scored = [...items];
  scored.sort((a, b) => {
    const delta = score(b) - score(a);
    if (delta !== 0) return delta;
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return a.addressableId < b.addressableId ? -1 : a.addressableId > b.addressableId ? 1 : 0;
  });
  return scored;
}

/** Why-line for a track: zaps when we actually have them, then age. Never
 *  fabricates a play count — plays are authed server-side and guests never
 *  register, so any number we showed would be a lie of omission. */
export function trackSignalLabel(
  item: RankableTrack,
  zaps: ZapsByCoordinate,
  nowMs = Date.now(),
): string {
  const parts: string[] = [];
  const count = zapCountFor(item, zaps);
  if (count > 0) parts.push(`${count} ${count === 1 ? "zap" : "zaps"}`);
  parts.push(formatAge(item.createdAt, nowMs));
  return parts.join(" · ");
}

export function formatAge(unixSeconds: number, nowMs: number = Date.now()): string {
  const deltaS = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (deltaS < 3600) return `${Math.max(1, Math.round(deltaS / 60))}m`;
  if (deltaS < DAY_S) return `${Math.round(deltaS / 3600)}h`;
  return `${Math.round(deltaS / DAY_S)}d`;
}

// ─── Honest fallback disclosure ────────────────────────────────────────

export type SortIntent = "trending" | "recent" | "active" | "new" | "big";

const SORT_LABEL: Record<SortIntent, string> = {
  trending: "Trending",
  recent: "Recent",
  active: "Active",
  new: "New",
  big: "Biggest",
};

/** The line a section header shows when what we asked for is not what we got.
 *  Null when the sort delivered — no need to explain the expected case. */
export function sortDisclosure(requested: SortIntent, actual: SortIntent): string | null {
  if (requested === actual) return null;
  if (requested === "trending" && actual === "recent") {
    return "Recent — not enough signal for trending yet";
  }
  return `${SORT_LABEL[actual]} — ${requested} unavailable`;
}
