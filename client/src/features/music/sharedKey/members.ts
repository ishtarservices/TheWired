// Wire helpers for shared projects (soot docs/collab-shared-key.md §1, §2).
// Pure: no store, no keychain.

import type { MusicMember, MusicMemberRole } from "@/types/music";

/** p-tag roles that name a project member (not a credit). `owner` is a human
 *  holder of the shared project key; the rest are keyless members. */
export const MEMBER_ROLES: ReadonlySet<string> = new Set<MusicMemberRole>(["owner", "collaborator", "contributor", "editor"]);

/** Member p-tags in tag order, one per (pubkey, role). */
export function parseMembers(tags: string[][]): MusicMember[] {
  const out: MusicMember[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (t[0] !== "p" || !t[1] || !MEMBER_ROLES.has(t[3] ?? "")) continue;
    const key = `${t[1]}:${t[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pubkey: t[1], role: t[3] as MusicMemberRole });
  }
  return out;
}

/** p-tags for a member list, for rebuilding an event without losing members. */
export function memberPTags(members: readonly MusicMember[] | undefined): string[][] {
  return (members ?? []).map((m) => ["p", m.pubkey, "", m.role]);
}

/** Key holders named on a release, in tag order (the first started it). */
export function ownersOf(members: readonly MusicMember[] | undefined): string[] {
  return (members ?? []).filter((m) => m.role === "owner").map((m) => m.pubkey);
}

/** A shared release carries an `owner` p-tag naming someone other than its
 *  author (the author of a personal release is its owner). */
export function isSharedRelease(item: { pubkey: string; owners?: readonly string[] }): boolean {
  return (item.owners ?? []).some((pk) => pk !== item.pubkey);
}

const MOVED_RE = /^(31683|33123):[0-9a-f]{64}:.+$/;

/** The `moved` target of a rotation stub, or null for a live release. Only a
 *  same-kind coordinate counts. */
export function movedTargetOf(event: { kind: number; tags: string[][] }): string | null {
  const target = event.tags.find((t) => t[0] === "moved")?.[1];
  if (!target || !MOVED_RE.test(target) || !target.startsWith(`${event.kind}:`)) return null;
  return target;
}

/** `kind:pubkey:d` of an addressable event. */
export function addressOf(event: { kind: number; pubkey: string; tags: string[][] }): string {
  const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  return `${event.kind}:${event.pubkey}:${d}`;
}
