import type { SpaceMember, SpaceRole } from "../../types/space";

export interface RoleGroup {
  roleId: string;
  label: string;
  color?: string;
  position: number;
  pubkeys: string[];
}

/** Synthetic group key/labels for fallback paths so legacy creators/admins
 *  without explicit role rows still render correctly. */
const SYNTHETIC_ADMIN_KEY = "__admin_fallback__";
const DEFAULT_KEY = "__default__";

/**
 * Build Discord-style role groups for the member side panel and settings tab.
 *
 * Single source of truth: `members` (SpaceMember[] from spaceConfig.members).
 *
 * Fallback rules — needed because the backend doesn't always have an explicit
 * role row for every member (creators in particular):
 *   1. Member has roles → group by highest (lowest position).
 *   2. Member is in `adminPubkeys` or matches `creatorPubkey` → synthetic Admin group.
 *   3. Otherwise → default group, named after the space's default role.
 */
export function buildRoleGroups(
  members: SpaceMember[],
  roles: SpaceRole[],
  adminPubkeys: string[],
  creatorPubkey: string,
): RoleGroup[] {
  const defaultRole = roles.find((r) => r.isDefault);
  const adminSet = new Set(adminPubkeys);
  const groupMap = new Map<string, RoleGroup>();

  // Find the highest-position role flagged isAdmin to provide the "Admin" label
  // for the synthetic fallback group. If none, label it "Admin" with no color.
  const adminRole = [...roles]
    .filter((r) => r.isAdmin)
    .sort((a, b) => a.position - b.position)[0];

  for (const member of members) {
    const sortedRoles = [...member.roles].sort((a, b) => a.position - b.position);
    const topRole = sortedRoles[0];

    let groupKey: string;
    let label: string;
    let color: string | undefined;
    let position: number;

    if (topRole) {
      groupKey = topRole.id;
      label = topRole.name;
      color = topRole.color ?? undefined;
      position = topRole.position;
    } else if (adminSet.has(member.pubkey) || member.pubkey === creatorPubkey) {
      // Synthetic admin fallback — keeps the creator/legacy admins out of "Members"
      groupKey = SYNTHETIC_ADMIN_KEY;
      label = adminRole?.name ?? "Admin";
      color = adminRole?.color ?? undefined;
      position = adminRole?.position ?? 0;
    } else {
      groupKey = DEFAULT_KEY;
      label = defaultRole?.name ?? "Members";
      color = defaultRole?.color ?? undefined;
      position = defaultRole?.position ?? 999;
    }

    let group = groupMap.get(groupKey);
    if (!group) {
      group = { roleId: groupKey, label, color, position, pubkeys: [] };
      groupMap.set(groupKey, group);
    }
    group.pubkeys.push(member.pubkey);
  }

  return [...groupMap.values()].sort((a, b) => a.position - b.position);
}
