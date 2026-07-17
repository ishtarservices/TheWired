// Membership checks over the backend /members roster. Membership is
// deliberately NOT cached — the join CTA and composer gating must stay
// correct the moment the user joins or leaves (join/leave flows call
// invalidateMembership synchronously, so their own mutations are never
// masked by a stale window). What IS safe is a 10s in-flight/settled dedup
// window: one drill-down fans out to several screens (space → channel →
// members → feed) inside a second or two, and one roster fetch can serve
// them all — the window is far shorter than any join/leave round trip a
// user can perform, and mutations evict it anyway.

import { API_BASE } from "./discovery";
import { parseMemberPubkeys } from "./spaces";

export const MEMBERSHIP_WINDOW_MS = 10_000;

interface Entry {
  at: number;
  promise: Promise<string[]>;
}

const rosters = new Map<string, Entry>();

/** Full member roster — THROWS on failure, unlike fetchSpaceMemberPubkeys'
 *  []-on-error contract (which display surfaces rely on): a membership
 *  check must distinguish "not a member" from "couldn't check". */
async function fetchRoster(spaceId: string): Promise<string[]> {
  const response = await fetch(
    `${API_BASE}/spaces/${encodeURIComponent(spaceId)}/members`,
  );
  if (!response.ok) throw new Error(`Members unavailable (${response.status})`);
  return parseMemberPubkeys(await response.json());
}

/** The full (uncapped) roster — feed-author resolution and membership
 *  checks. NEVER substitute spaceMetaSlice's memberPubkeys here: that is a
 *  display-only prefix which may be a stale 50-row hydrate. */
export function fetchMembershipRoster(spaceId: string): Promise<string[]> {
  const hit = rosters.get(spaceId);
  const now = Date.now();
  if (hit && now - hit.at < MEMBERSHIP_WINDOW_MS) return hit.promise;
  const promise = fetchRoster(spaceId);
  rosters.set(spaceId, { at: now, promise });
  // A failed fetch must not poison the window — drop it so the next call retries.
  promise.catch(() => {
    if (rosters.get(spaceId)?.promise === promise) rosters.delete(spaceId);
  });
  return promise;
}

/** Throws on failure — callers decide whether to retry or fail closed. */
export async function isMemberOf(spaceId: string, pubkey: string): Promise<boolean> {
  return (await fetchMembershipRoster(spaceId)).includes(pubkey);
}

/** Call synchronously after join/leave — the next check refetches. */
export function invalidateMembership(spaceId: string): void {
  rosters.delete(spaceId);
}

/** Test hook. */
export function clearMembership(): void {
  rosters.clear();
}
