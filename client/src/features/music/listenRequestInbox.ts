import type { MusicProposal } from "@/types/music";
import type { MuteEntry } from "@/store/slices/identitySlice";
import { isListenRequest } from "./listenRequestWire";

/**
 * Owner-side inbox shaping for listen requests. The backend serves raw rows;
 * older databases hold several rows for one requester+target (before the
 * deterministic d-tag), so the inbox collapses them to one entry per
 * `proposerPubkey + targetAlbum`, keeping the newest row for display and
 * every sibling row id so a grant/decline resolves all of them.
 */

export interface ListenRequestGroup {
  /** `${proposerPubkey}|${targetRef}` */
  key: string;
  proposerPubkey: string;
  ownerPubkey: string;
  targetRef: string;
  /** The newest row (by createdAt) in the group. */
  latest: MusicProposal;
  /** Every backend row id in the group, newest first. */
  rowIds: string[];
  createdAt: number;
}

export interface ListenRequestRelease {
  targetRef: string;
  groups: ListenRequestGroup[];
  newestAt: number;
}

export function listenRequestKey(proposerPubkey: string, targetRef: string): string {
  return `${proposerPubkey}|${targetRef}`;
}

/** Pubkeys on the user's mute list. */
export function mutedPubkeys(muteList: readonly MuteEntry[]): Set<string> {
  const out = new Set<string>();
  for (const m of muteList) if (m.type === "pubkey" && m.value) out.add(m.value);
  return out;
}

/**
 * Open listen-request rows → one group per requester+target, newest first.
 * Drops tracklist proposals, resolved rows, rows owned by someone else (when
 * `me` is given), self-requests, and requests from muted accounts.
 */
export function collapseListenRequests(
  rows: readonly MusicProposal[],
  opts: { me?: string | null; muted?: ReadonlySet<string> } = {},
): ListenRequestGroup[] {
  const byKey = new Map<string, { rows: MusicProposal[] }>();
  for (const row of rows) {
    if (row.status !== "open" || !isListenRequest(row)) continue;
    if (opts.me && row.ownerPubkey !== opts.me) continue;
    if (row.proposerPubkey === row.ownerPubkey) continue;
    if (opts.muted?.has(row.proposerPubkey)) continue;
    const key = listenRequestKey(row.proposerPubkey, row.targetAlbum);
    const entry = byKey.get(key);
    if (entry) entry.rows.push(row);
    else byKey.set(key, { rows: [row] });
  }

  const groups: ListenRequestGroup[] = [];
  for (const [key, { rows: siblings }] of byKey) {
    // Stable newest-first: ties keep server order.
    const sorted = siblings
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.createdAt - a.r.createdAt || a.i - b.i)
      .map((x) => x.r);
    const latest = sorted[0];
    groups.push({
      key,
      proposerPubkey: latest.proposerPubkey,
      ownerPubkey: latest.ownerPubkey,
      targetRef: latest.targetAlbum,
      latest,
      rowIds: [...new Set(sorted.map((r) => r.id))],
      createdAt: latest.createdAt,
    });
  }
  return groups.sort((a, b) => b.createdAt - a.createdAt);
}

/** Groups → one bucket per release, the release with the newest ask first. */
export function groupByRelease(groups: readonly ListenRequestGroup[]): ListenRequestRelease[] {
  const byTarget = new Map<string, ListenRequestGroup[]>();
  for (const g of groups) {
    const list = byTarget.get(g.targetRef);
    if (list) list.push(g);
    else byTarget.set(g.targetRef, [g]);
  }
  return [...byTarget.entries()]
    .map(([targetRef, list]) => {
      const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
      return { targetRef, groups: sorted, newestAt: sorted[0].createdAt };
    })
    .sort((a, b) => b.newestAt - a.newestAt);
}
