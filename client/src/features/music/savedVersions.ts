/**
 * Pure rules for the "Update Available" state of saved music (WIR-165).
 *
 * The backend row is a hint, not the truth: the ingester may lag the relays
 * the client reads, and the client may lag the ingester. So an update is
 * pending when EITHER side knows a strictly newer event than the saved one,
 * and acknowledging always targets the newest version either side knows.
 */
import type { MusicAlbum, MusicTrack, SavedAlbumVersion } from "@/types/music";

export interface VersionRef {
  eventId: string;
  createdAt: number;
}

type Current = Pick<MusicTrack | MusicAlbum, "eventId" | "createdAt"> | undefined;

/** Newest event known for a saved item: the local one, or the ingester's. */
export function newestKnownVersion(saved: SavedAlbumVersion, current: Current): VersionRef {
  let best: VersionRef = { eventId: saved.savedEventId, createdAt: saved.savedCreatedAt };
  if (saved.latestEventId && saved.latestCreatedAt && saved.latestCreatedAt > best.createdAt) {
    best = { eventId: saved.latestEventId, createdAt: saved.latestCreatedAt };
  }
  if (current && current.createdAt > best.createdAt && current.eventId !== saved.savedEventId) {
    best = { eventId: current.eventId, createdAt: current.createdAt };
  }
  return best;
}

/**
 * True when a strictly newer version than the saved one exists — on the
 * backend (`hasUpdate` + `latest*`) or already in Redux (`current`). The same
 * event re-delivered is never an update; neither is an older event.
 */
export function hasPendingUpdate(saved: SavedAlbumVersion | undefined, current: Current): boolean {
  if (!saved) return false;
  const newest = newestKnownVersion(saved, current);
  if (newest.eventId === saved.savedEventId) return false;
  // The backend hint alone counts only when it carries the newer event; a bare
  // `hasUpdate` with nothing newer attached is the old unconditional flag.
  return newest.createdAt > saved.savedCreatedAt;
}

/** The saved item's version the client should fetch from relays, if the
 *  ingester knows a newer event than the client holds. */
export function needsFetch(saved: SavedAlbumVersion, current: Current): boolean {
  if (!saved.latestEventId || !saved.latestCreatedAt) return false;
  if (saved.latestCreatedAt <= saved.savedCreatedAt) return false;
  return !current || current.createdAt < saved.latestCreatedAt;
}

/** Group addressable ids into one filter per `kind:author`, each with the
 *  given `since`. Used to ask relays for newer versions of saved items. */
export function buildVersionFilters(
  items: Array<{ addressableId: string; since: number }>,
): Array<{ kinds: number[]; authors: string[]; "#d": string[]; since: number }> {
  const groups = new Map<string, { kind: number; author: string; dTags: string[]; since: number }>();
  for (const { addressableId, since } of items) {
    const parts = addressableId.split(":");
    if (parts.length < 3) continue;
    const kind = parseInt(parts[0], 10);
    if (!Number.isFinite(kind)) continue;
    const key = `${parts[0]}:${parts[1]}`;
    const dTag = parts.slice(2).join(":");
    const g = groups.get(key);
    if (g) {
      g.dTags.push(dTag);
      g.since = Math.min(g.since, since);
    } else {
      groups.set(key, { kind, author: parts[1], dTags: [dTag], since });
    }
  }
  return [...groups.values()].map((g) => ({ kinds: [g.kind], authors: [g.author], "#d": g.dTags, since: g.since }));
}

export function kindOf(addressableId: string): number {
  return parseInt(addressableId.split(":")[0] ?? "", 10);
}
