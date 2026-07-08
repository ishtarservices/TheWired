// Short-lived cache over the space detail/channel GETs so click-through
// (directory → space → channel) doesn't refetch the same rows per screen.
// Membership is deliberately NOT cached — the join CTA must stay correct.

import {
  fetchSpaceChannels,
  fetchSpaceDetail,
  type SpaceChannel,
  type SpaceDetail,
} from "./spaces";

const TTL_MS = 45_000;

interface Entry<T> {
  at: number;
  promise: Promise<T>;
}

const details = new Map<string, Entry<SpaceDetail>>();
const channels = new Map<string, Entry<SpaceChannel[]>>();

function through<T>(
  map: Map<string, Entry<T>>,
  key: string,
  fetcher: (key: string) => Promise<T>,
): Promise<T> {
  const hit = map.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.promise;
  const promise = fetcher(key);
  map.set(key, { at: now, promise });
  // A failed fetch must not poison the window — drop it so the next call retries.
  promise.catch(() => {
    if (map.get(key)?.promise === promise) map.delete(key);
  });
  return promise;
}

export function cachedSpaceDetail(spaceId: string): Promise<SpaceDetail> {
  return through(details, spaceId, fetchSpaceDetail);
}

export function cachedSpaceChannels(spaceId: string): Promise<SpaceChannel[]> {
  return through(channels, spaceId, fetchSpaceChannels);
}

/** Call after join/leave (memberCount, mode-dependent UI) — next read refetches. */
export function invalidateSpace(spaceId: string): void {
  details.delete(spaceId);
  channels.delete(spaceId);
}

/** Test hook. */
export function clearSpaceCache(): void {
  details.clear();
  channels.clear();
}
